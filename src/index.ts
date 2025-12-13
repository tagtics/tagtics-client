type TagticsConfig = {
    apiKey: string;
    serializeChildDepth?: number;
    privacyNotice?: string;
    allowSensitivePages?: boolean;
    logoUrl?: string;
    includePaths?: string[]; // Regex strings to include
    excludePaths?: string[]; // Regex strings to exclude
    testingMode?: boolean;
    port?: number | string;
};

let config: TagticsConfig | null = null;
let hostElement: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let isPicking = false;
let overlay: HTMLElement | null = null;
let modal: HTMLElement | null = null;
let selectedElement: HTMLElement | null = null;

// --- Payment Detection Heuristics ---
const PAYMENT_KEYWORDS = ['checkout', 'payment', 'pay', 'billing', 'order', 'purchase', 'invoice', 'subscribe'];
const PAYMENT_PROVIDERS = ['stripe.com', 'paypal.com', 'braintreepayments.com', 'square.com', 'adyen.com', 'razorpay.com'];
const SENSITIVE_INPUT_PATTERNS = /card|cc-|cvv|cvc|expiry|billing|cardholder/i;

export function isLikelyPaymentPage(): boolean {
    const url = window.location.href.toLowerCase();
    if (PAYMENT_KEYWORDS.some(kw => url.includes(kw))) return true;

    // Check for payment providers in scripts or iframes (simple check)
    // Note: This is a heuristic, not exhaustive.
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
        if (script.src && PAYMENT_PROVIDERS.some(p => script.src.includes(p))) return true;
    }

    // Check for sensitive inputs
    const inputs = document.querySelectorAll('input, select, textarea');
    for (const input of inputs) {
        const name = input.getAttribute('name') || '';
        const id = input.id || '';
        const placeholder = input.getAttribute('placeholder') || '';
        const ariaLabel = input.getAttribute('aria-label') || '';

        if (SENSITIVE_INPUT_PATTERNS.test(name) ||
            SENSITIVE_INPUT_PATTERNS.test(id) ||
            SENSITIVE_INPUT_PATTERNS.test(placeholder) ||
            SENSITIVE_INPUT_PATTERNS.test(ariaLabel)) {
            return true;
        }
    }

    // Check for cross-origin iframes as a hint (if other signals are weak, this might be too aggressive, but per requirements: "Cross-origin iframes exist (treat as strong hint)")
    // The requirement says "If any check passes, treat page as payment/checkout."
    // So we check for cross-origin iframes.
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
        if (isCrossOrigin(iframe)) return true;
    }

    return false;
}

function isCrossOrigin(iframe: HTMLIFrameElement): boolean {
    try {
        return !iframe.contentDocument;
    } catch (e) {
        return true;
    }
}


// --- Iframe / Embed Handling ---
export function getEmbeds() {
    const embeds = document.querySelectorAll('iframe, embed, object');
    const embedHostnames: string[] = [];
    let hasEmbeds = false;

    embeds.forEach(el => {
        hasEmbeds = true;
        let src = '';
        if (el instanceof HTMLIFrameElement || el instanceof HTMLEmbedElement) {
            src = el.src;
        } else if (el instanceof HTMLObjectElement) {
            src = el.data;
        }

        if (src) {
            try {
                const url = new URL(src);
                if (!embedHostnames.includes(url.hostname)) {
                    embedHostnames.push(url.hostname);
                }
            } catch (e) {
                // ignore invalid urls
            }
        }
    });
    return { hasEmbeds, embedHostnames };
}


// --- Serialization ---

export function getXPath(element: Element): string {
    if (element.id) {
        return `//*[@id="${element.id}"]`;
    }
    if (element === document.body) {
        return '/html/body';
    }
    if (!element.parentNode || element.parentNode.nodeType !== Node.ELEMENT_NODE) {
        // Fallback for detached or root
        return element.tagName.toLowerCase();
    }

    let ix = 0;
    const siblings = element.parentNode.childNodes;
    for (let i = 0; i < siblings.length; i++) {
        const sibling = siblings[i];
        if (sibling === element) {
            return getXPath(element.parentNode as Element) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
        }
        if (sibling.nodeType === 1 && (sibling as Element).tagName === element.tagName) {
            ix++;
        }
    }
    return '';
}


export function serializeElement(el: HTMLElement, depth: number, currentDepth = 0): any {
    const tagName = el.tagName.toLowerCase();
    const attributes: Record<string, string> = {};

    // Redact attributes
    const REDACT_ATTR_REGEX = /password|ssn|card|credit|cvv|pin/i;

    for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        if (REDACT_ATTR_REGEX.test(attr.name)) {
            attributes[attr.name] = '[REDACTED]';
        } else if (attr.name === 'value' && (tagName === 'input' || tagName === 'textarea')) {
            attributes[attr.name] = 'test value';
        } else {
            attributes[attr.name] = attr.value;
        }
    }

    let text = '';
    // Text only for leaf nodes that are not inputs/contentEditable
    if (el.children.length === 0 && tagName !== 'input' && tagName !== 'textarea' && tagName !== 'select' && !el.isContentEditable) {
        text = (el.textContent || '').substring(0, 200);
    }

    // Computed styles
    const computed = window.getComputedStyle(el);
    const styleKeys = ['display', 'position', 'width', 'height', 'margin', 'padding', 'background-color', 'color', 'font-size', 'font-family', 'border', 'border-radius', 'box-shadow', 'overflow', 'text-align'];
    const styles: Record<string, string> = {};
    styleKeys.forEach(key => {
        const val = computed.getPropertyValue(key);
        if (!val.includes('data:')) { // Remove data URIs
            styles[key] = val;
        }
    });

    const children: any[] = [];
    if (currentDepth < depth) {
        for (let i = 0; i < el.children.length; i++) {
            const child = el.children[i];
            if (child instanceof HTMLElement) {
                children.push(serializeElement(child, depth, currentDepth + 1));
            }
        }
    }

    return { tag: tagName, attributes, text, styles, children };
}


// --- UI & Interaction ---

function createStyles() {
    const style = document.createElement('style');
    style.textContent = `
        :host { 
            all: initial; 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
            position: fixed; 
            top: 0; 
            left: 0; 
            width: 100vw; 
            height: 100vh; 
            z-index: 2147483647; 
            pointer-events: none; 
            color-scheme: dark;
        }

        /* --- FAB Container & Items --- */
        .tagtics-fab-container {
            position: fixed; bottom: 20px; right: 20px;
            display: flex; flex-direction: column; align-items: center; gap: 16px;
            z-index: 2147483647; 
            pointer-events: none;
        }
        
        /* Hide on devices without hover (touch devices) or small screens */
        @media (hover: none), (max-width: 768px) {
            .tagtics-fab-container {
                display: none !important;
            }
        }
        .tagtics-fab-main {
            pointer-events: auto;
            width: 56px; height: 56px; border-radius: 28px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: white; border: none;
            box-shadow: 0 8px 20px rgba(99, 102, 241, 0.4);
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            font-size: 28px; transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            z-index: 2;
        }
        .tagtics-fab-container.open .tagtics-fab-main {
            transform: rotate(45deg) scale(0.9);
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
        }
        .tagtics-fab-item {
            pointer-events: auto;
            width: 48px; height: 48px; border-radius: 24px;
            background: rgba(30, 30, 30, 0.8);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: white; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            font-size: 20px; transition: all 0.2s ease;
            position: relative;
            opacity: 0; transform: translateY(10px) scale(0.9);
            visibility: hidden;
        }
        .tagtics-fab-item:hover {
            background: rgba(50, 50, 50, 0.9);
            transform: scale(1.05);
            box-shadow: 0 6px 16px rgba(0,0,0,0.3);
        }
        .tagtics-fab-container.open .tagtics-fab-item {
            opacity: 1; transform: translateY(0) scale(1);
            visibility: visible;
        }
        .tagtics-fab-label {
            position: absolute; right: 60px;
            background: rgba(20, 20, 20, 0.9);
            backdrop-filter: blur(8px);
            color: #ececec; padding: 6px 12px; border-radius: 8px;
            font-size: 13px; font-weight: 500; white-space: nowrap;
            opacity: 0; pointer-events: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            border: 1px solid rgba(255, 255, 255, 0.05);
            transform: translateX(10px);
            transition: opacity 0.2s ease, transform 0.2s ease;
        }
        .tagtics-fab-item:hover .tagtics-fab-label {
            opacity: 1;
            transform: translateX(0);
        }

        /* --- Modal (Glassmorphism) --- */
        .tagtics-modal {
            position: fixed; bottom: 100px; right: 32px; width: 340px;
            background: rgba(23, 23, 23, 0.75);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 20px; 
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
            padding: 24px; 
            display: none; flex-direction: column; gap: 16px;
            pointer-events: auto;
            color: #f3f3f3;
            animation: modalIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes modalIn {
            from { opacity: 0; transform: translateY(20px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .tagtics-modal.open { display: flex; }

        .element-desc { 
            font-size: 11px; font-family: 'Menlo', 'Monaco', monospace; 
            color: #a5b4fc; background: rgba(99, 102, 241, 0.1);
            padding: 8px 12px; border-radius: 8px;
            word-break: break-all; border: 1px solid rgba(99, 102, 241, 0.2);
        }
        
        textarea { 
            width: 100%; height: 100px; 
            background: rgba(0, 0, 0, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            color: white; padding: 12px; box-sizing: border-box; 
            font-family: inherit; font-size: 14px; resize: none;
            outline: none; transition: border-color 0.2s, background 0.2s;
        }
        textarea:focus {
            border-color: rgba(99, 102, 241, 0.5);
            background: rgba(0, 0, 0, 0.3);
        }
        textarea::placeholder { color: rgba(255, 255, 255, 0.3); }

        .char-counter {
            font-size: 12px;
            color: #999;
            text-align: right;
            margin-top: -12px;
            transition: color 0.2s;
        }

        button.primary { 
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: white; border: none; padding: 12px 20px; 
            border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 14px;
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
            transition: transform 0.1s, box-shadow 0.2s;
        }
        button.primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4);
        }
        button.primary:active { transform: translateY(1px); }

        button.secondary {
            background: rgba(255, 255, 255, 0.1);
            color: white; border: 1px solid rgba(255, 255, 255, 0.2);
            padding: 12px 20px; border-radius: 12px; cursor: pointer;
            font-weight: 600; font-size: 14px;
            transition: all 0.2s;
            flex: 1;
        }
        button.secondary:hover {
            background: rgba(255, 255, 255, 0.15);
            border-color: rgba(255, 255, 255, 0.3);
        }
        button.primary {
            flex: 1;
        }

        .privacy-notice { font-size: 11px; color: rgba(255, 255, 255, 0.4); line-height: 1.4; }

        /* --- Highlights & Tooltips --- */
        .tagtics-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            pointer-events: none;
        }
        .tagtics-highlight {
            position: fixed; border: 2px solid #007bff; background: rgba(0,123,255,0.1);
            pointer-events: none; transition: all 0.2s ease;
            z-index: 2147483646; /* Internal z-index */
        }
        .tagtics-tooltip {
            position: fixed; background: rgba(20, 20, 20, 0.9); 
            backdrop-filter: blur(4px);
            color: white; padding: 6px 10px;
            border-radius: 6px; font-size: 11px; pointer-events: none; 
            display: none; z-index: 2147483647;
            border: 1px solid rgba(255,255,255,0.1);
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }

        /* --- Toasts --- */
        .tagtics-toast {
            position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%) translateY(20px);
            background: rgba(30, 30, 30, 0.9);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            color: white; padding: 12px 24px; 
            border-radius: 50px; 
            border: 1px solid rgba(255, 255, 255, 0.1);
            font-size: 14px; font-weight: 500;
            opacity: 0; transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            z-index: 2147483647; pointer-events: none;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            display: flex; align-items: center; gap: 8px;
        }
        .tagtics-toast.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
        .tagtics-toast.success { border-color: rgba(34, 197, 94, 0.3); color: #dcfce7; }
        .tagtics-toast.success::before { content: '✓'; color: #22c55e; font-weight: bold; }
        .tagtics-toast.error { border-color: rgba(239, 68, 68, 0.3); color: #fee2e2; }
        .tagtics-toast.error::before { content: '!'; color: #ef4444; font-weight: bold; }
    `;
    return style;
}

function showToast(message: string, type: 'success' | 'error' = 'success') {
    let toast = shadowRoot!.querySelector('.tagtics-toast') as HTMLElement;
    if (!toast) {
        toast = document.createElement('div');
        shadowRoot!.appendChild(toast);
    }
    // Reset classes to base
    toast.className = 'tagtics-toast';
    // Force reflow
    void toast.offsetWidth;

    toast.textContent = message;
    toast.classList.add(type);
    toast.classList.add('visible');

    setTimeout(() => {
        toast.classList.remove('visible');
    }, 3000);
}

function blockEvents() {
    // Block all interaction events to stop focus, typing, clicking links etc.
    const events = [
        'keydown', 'keypress', 'keyup',
        'mousedown', 'mouseup', 'touchstart', 'touchend',
        'focus', 'focusin'
    ];
    const handler = (e: Event) => {
        // Allow Escape key and page reload keys
        if (e.type === 'keydown' || e.type === 'keyup' || e.type === 'keypress') {
            const key = (e as KeyboardEvent).key;
            const ctrlKey = (e as KeyboardEvent).ctrlKey;
            const metaKey = (e as KeyboardEvent).metaKey;

            // Allow Escape, F5, Ctrl+R, Cmd+R
            if (key === 'Escape') return;
            if (key === 'F5') return;
            if ((ctrlKey || metaKey) && (key === 'r' || key === 'R')) return;
        }
        e.preventDefault();
        e.stopPropagation();
    };
    (window as any)._tagticsBlocker = { events, handler };
    events.forEach(evt => window.addEventListener(evt, handler, { capture: true, passive: false }));
}

function unblockEvents() {
    if ((window as any)._tagticsBlocker) {
        const { events, handler } = (window as any)._tagticsBlocker;
        events.forEach((evt: string) => window.removeEventListener(evt, handler, { capture: true }));
        delete (window as any)._tagticsBlocker;
    }
}

function showModal(fromPicking: boolean) {
    if (!modal) return;
    modal.style.display = 'flex';
    const desc = shadowRoot!.querySelector('.element-desc') as HTMLElement;
    if (desc) {
        desc.style.display = fromPicking ? 'block' : 'none';
    }
    const privacy = modal.querySelector('.privacy-notice') as HTMLElement;
    if (privacy && !fromPicking) {
        // Optional: change text for page feedback?
    }
    const repickBtn = modal.querySelector('.secondary') as HTMLElement;
    if (repickBtn) {
        repickBtn.style.display = fromPicking ? 'block' : 'none';
    }
    const fab = shadowRoot!.querySelector('.tagtics-fab-container') as HTMLElement;
    if (fab) fab.style.display = 'none';
}

function startPicking() {
    isPicking = true;
    blockEvents();
    modal!.style.display = 'none';
    const fab = shadowRoot!.querySelector('.tagtics-fab-container') as HTMLElement;
    if (fab) {
        fab.classList.remove('open');
        fab.style.display = 'none'; // Hide entirely during picking
    }
    document.body.style.cursor = 'crosshair';

    // Add overlay for highlighting
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'tagtics-overlay';
        // ... (comments removed for brevity)
    }

    // Reuse or create highlight elements
    let highlightBox = shadowRoot!.querySelector('.tagtics-highlight') as HTMLElement;
    if (!highlightBox) {
        highlightBox = document.createElement('div');
        highlightBox.className = 'tagtics-highlight';
        shadowRoot!.appendChild(highlightBox);
    }
    highlightBox.style.display = 'none';

    let tooltip = shadowRoot!.querySelector('.tagtics-tooltip') as HTMLElement;
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'tagtics-tooltip';
        tooltip.innerText = 'Embedded content not selectable';
        shadowRoot!.appendChild(tooltip);
    }
    tooltip.style.display = 'none';

    const mouseOverHandler = (e: MouseEvent) => {
        if (!isPicking) return;
        const target = e.target as HTMLElement;

        // Check for iframes/embeds
        if (target.tagName === 'IFRAME' || target.tagName === 'EMBED' || target.tagName === 'OBJECT') {
            if (isCrossOrigin(target as HTMLIFrameElement)) {
                const rect = target.getBoundingClientRect();
                tooltip.style.display = 'block';
                tooltip.style.top = `${rect.top - 30}px`;
                tooltip.style.left = `${rect.left}px`;
                highlightBox.style.display = 'none';
                return;
            }
        }
        tooltip.style.display = 'none';

        if (target === hostElement || target.id === 'tagtics-host') return;


        const rect = target.getBoundingClientRect();
        highlightBox.style.display = 'block';
        highlightBox.style.position = 'fixed';
        highlightBox.style.top = `${rect.top}px`;
        highlightBox.style.left = `${rect.left}px`;
        highlightBox.style.width = `${rect.width}px`;
        highlightBox.style.height = `${rect.height}px`;
    };

    const clickHandler = (e: MouseEvent) => {
        if (!isPicking) return;
        e.preventDefault();
        e.stopPropagation();

        const target = e.target as HTMLElement;

        // Check for iframes/embeds
        if (target.tagName === 'IFRAME' || target.tagName === 'EMBED' || target.tagName === 'OBJECT') {
            if (isCrossOrigin(target as HTMLIFrameElement)) {
                return;
            }
        }

        if (target === hostElement || target.id === 'tagtics-host') return;

        stopPicking();
        selectElement(target);
    };

    const resizeHandler = () => {
        if (isPicking) {
            stopPicking(false); // Exit picking mode without opening modal
        }
    };

    // Delay attaching listeners to avoid catching the triggering click
    setTimeout(() => {
        document.addEventListener('mouseover', mouseOverHandler);
        document.addEventListener('click', clickHandler, { capture: true });
        window.addEventListener('resize', resizeHandler); // Exit on resize

        // Store handlers
        (window as any)._tagticsHandlers = { mouseOverHandler, clickHandler, resizeHandler, highlightBox, tooltip };
    }, 50);
}

function stopPicking(proceedToModal: boolean = true) {
    isPicking = false;
    unblockEvents();
    document.body.style.cursor = 'default';
    if ((window as any)._tagticsHandlers) {
        const { mouseOverHandler, clickHandler, resizeHandler, highlightBox, tooltip } = (window as any)._tagticsHandlers;
        document.removeEventListener('mouseover', mouseOverHandler);
        document.removeEventListener('click', clickHandler, { capture: true });
        if (resizeHandler) window.removeEventListener('resize', resizeHandler);
        highlightBox.remove();
        tooltip.remove();
        delete (window as any)._tagticsHandlers;
    }
    if (proceedToModal) {
        showModal(true);
    } else {
        closeModal();
    }
}

function selectElement(el: HTMLElement) {
    selectedElement = el;

    // Animate ancestors
    // Requirement: "Animate highlight sequence parent → child (short delays)."
    // We'll just highlight the selected element for now to keep it simple and robust.
    // To do the sequence, we'd need to find ancestors and flash the highlight box.

    // Generate Breadcrumb Path (up to 3 levels up or until ID)
    let currentEl: HTMLElement | null = el;
    const pathParts: string[] = [];

    // We'll traverse up to 3 levels max to keep it readable, or until we hit an ID
    for (let i = 0; i < 4 && currentEl; i++) {
        let name = currentEl.tagName.toLowerCase();

        if (currentEl.id) {
            name += `#${currentEl.id}`;
            pathParts.unshift(name);
            break; // Stop if we find an ID, that's usually specific enough
        } else {
            let className = '';
            if (typeof currentEl.className === 'string') {
                className = currentEl.className;
            } else if (currentEl.className && typeof (currentEl.className as any).baseVal === 'string') {
                className = (currentEl.className as any).baseVal;
            }
            if (className) {
                // Only take the first class to save space
                const firstClass = className.split(' ').filter(Boolean)[0];
                if (firstClass) name += `.${firstClass}`;
            }
            pathParts.unshift(name);
        }

        currentEl = currentEl.parentElement;
        if (currentEl === document.body || currentEl === document.documentElement) break;
    }

    const descriptor = pathParts.join(' > ');

    const descEl = shadowRoot!.querySelector('.element-desc');
    if (descEl) descEl.textContent = descriptor;

    // Keep highlighted
    const rect = el.getBoundingClientRect();
    const highlightBox = document.createElement('div');
    highlightBox.className = 'tagtics-highlight';
    highlightBox.style.position = 'fixed';
    highlightBox.style.top = `${rect.top}px`;
    highlightBox.style.left = `${rect.left}px`;
    highlightBox.style.width = `${rect.width}px`;
    highlightBox.style.height = `${rect.height}px`;
    shadowRoot!.appendChild(highlightBox);

    // Remove previous highlight if any (except we just created one)
    // We should track the selection highlight
    if ((window as any)._selectionHighlight) {
        (window as any)._selectionHighlight.remove();
    }
    (window as any)._selectionHighlight = highlightBox;
}

async function sendFeedback(text: string) {
    if (!config) return;

    let payloadSelected = null;

    if (selectedElement) {
        const ancestors: any[] = [];
        let curr = selectedElement.parentElement;
        while (curr && curr !== document.body) {
            ancestors.push({
                xpath: getXPath(curr),
                tag: curr.tagName.toLowerCase(),
                descriptor: `${curr.tagName.toLowerCase()}${curr.id ? '#' + curr.id : ''} `
            });
            curr = curr.parentElement;
        }
        payloadSelected = {
            xpath: getXPath(selectedElement),
            tag: selectedElement.tagName.toLowerCase(),
            descriptor: shadowRoot!.querySelector('.element-desc')?.textContent,
            serialized: serializeElement(selectedElement, config.serializeChildDepth || 0),
            ancestors
        };
    } else {
        payloadSelected = { tag: 'PAGE_FEEDBACK' };
    }

    const { hasEmbeds, embedHostnames } = getEmbeds();

    const payload = {
        feedback: text,
        pageUrl: window.location.href,
        path: window.location.pathname,
        timestamp: Date.now(),
        clientMeta: {
            ua: navigator.userAgent,
            viewport: { width: window.innerWidth, height: window.innerHeight }
        },
        selected: payloadSelected,
        hasEmbeds,
        embedHostnames
    };

    // Optimistic UI: Close modal immediately, show toast on result
    closeModal();

    try {
        // Default to production endpoint
        let endpoint = `https://www.tagtics.online/new-feedback/${config.apiKey}`;

        if (config.testingMode) {
            // Check if running continuously on localhost (safety check)
            const hostname = window.location.hostname;
            if (hostname === 'localhost' || hostname === '127.0.0.1') {
                const port = config.port || 3000;
                endpoint = `http://localhost:${port}/tagtics/feedback`;
                console.log(`[Tagtics] Testing mode enabled. Sending feedback to ${endpoint}`);
            } else {
                console.warn('[Tagtics] Testing mode passed but not running on localhost. modify your config to enable testingMode only on localhost.');
            }
        }

        await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        showToast('Feedback sent successfully!', 'success');
    } catch (e) {
        console.error('Tagtics: Failed to send feedback', e);
        showToast('Failed to send feedback. Please try again.', 'error');
    }
}

function closeModal() {
    if (modal) modal.style.display = 'none';
    if ((window as any)._selectionHighlight) {
        (window as any)._selectionHighlight.remove();
        delete (window as any)._selectionHighlight;
    }
    selectedElement = null;
    const textarea = shadowRoot!.querySelector('textarea');
    if (textarea) textarea.value = '';
    const fab = shadowRoot!.querySelector('.tagtics-fab-container') as HTMLElement;
    if (fab) fab.style.display = 'flex';
}


// Helper function to check if current path should show widget
function shouldShowOnCurrentPath(): boolean {
    if (!config) return false;

    const path = window.location.pathname;

    // 1. Exclude Checks
    if (config.excludePaths) {
        for (const pattern of config.excludePaths) {
            try {
                if (new RegExp(pattern).test(path)) return false;
            } catch (e) { console.warn('[Tagtics] Invalid excludePaths regex:', pattern); }
        }
    }

    // 2. Include Checks
    if (config.includePaths && config.includePaths.length > 0) {
        let matched = false;
        for (const pattern of config.includePaths) {
            try {
                if (new RegExp(pattern).test(path)) {
                    matched = true;
                    break;
                }
            } catch (e) { console.warn('[Tagtics] Invalid includePaths regex:', pattern); }
        }
        if (!matched) return false;
    }

    // 3. Payment page check
    const isPayment = isLikelyPaymentPage();
    if (isPayment && !config.allowSensitivePages) return false;

    return true;
}

// Helper function to show/hide widget based on current path
function updateWidgetVisibility() {
    const shouldShow = shouldShowOnCurrentPath();
    const currentPath = window.location.pathname;

    console.log('[Tagtics] Route change detected:', currentPath, 'shouldShow:', shouldShow, 'hostElement exists:', !!hostElement);

    if (shouldShow && !hostElement) {
        // Show widget
        console.log('[Tagtics] Opening widget');
        open();
    } else if (!shouldShow && hostElement) {
        // Hide widget
        console.log('[Tagtics] Hiding widget');
        if (hostElement) {
            hostElement.style.display = 'none';
        }
    } else if (shouldShow && hostElement) {
        // Already showing, make sure it's visible
        console.log('[Tagtics] Widget already open, ensuring visibility');
        hostElement.style.display = 'block';
    }
}

export function init(c: TagticsConfig): void {
    if (!c.apiKey) {
        console.error('Tagtics: apiKey is required');
        return;
    }

    config = c;

    // Initial check
    updateWidgetVisibility();

    // Listen for route changes (SPA support)
    // Method 1: popstate (back/forward buttons)
    window.addEventListener('popstate', updateWidgetVisibility);

    // Method 2: Intercept pushState and replaceState (programmatic navigation)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        originalPushState.apply(this, args);
        updateWidgetVisibility();
    };

    history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        updateWidgetVisibility();
    };

    // Store references for cleanup
    (window as any)._tagticsRouteListener = updateWidgetVisibility;
    (window as any)._tagticsOriginalPushState = originalPushState;
    (window as any)._tagticsOriginalReplaceState = originalReplaceState;
}


export function open(): void {
    const isPayment = isLikelyPaymentPage();
    if (!config) {
        console.warn('Tagtics: Call init() before open()');
        return;
    }
    if (hostElement) return;

    hostElement = document.createElement('div');
    hostElement.id = 'tagtics-host';
    document.body.appendChild(hostElement);
    shadowRoot = hostElement.attachShadow({ mode: 'closed' });
    shadowRoot.appendChild(createStyles());

    const fabContainer = document.createElement('div');
    fabContainer.className = 'tagtics-fab-container';

    // Page Feedback Button
    const pageBtn = document.createElement('button');
    pageBtn.className = 'tagtics-fab-item';
    pageBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <line x1="10" y1="9" x2="8" y2="9"></line>
        </svg>
        <span class="tagtics-fab-label">Page Feedback</span>
    `;
    pageBtn.onclick = (e) => {
        e.stopPropagation();
        fabContainer.classList.remove('open');
        showModal(false); // Mode: Page feedback
    };
    fabContainer.appendChild(pageBtn);

    // Pick Element Button
    const pickBtn = document.createElement('button');
    pickBtn.className = 'tagtics-fab-item';
    pickBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path>
            <path d="M13 13l6 6"></path>
        </svg>
        <span class="tagtics-fab-label">Pick Element</span>
    `;
    pickBtn.onclick = (e) => {
        e.stopPropagation();
        if (isPayment && !config!.allowSensitivePages) {
            return;
        }
        fabContainer.classList.remove('open');
        startPicking();
    };
    fabContainer.appendChild(pickBtn);

    // Main Toggle Button
    const mainBtn = document.createElement('button');
    mainBtn.className = 'tagtics-fab-main';

    if (config.logoUrl) {
        mainBtn.innerHTML = `<img src="${config.logoUrl}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
    } else {
        // Let's use a simpler "Code Search" icon to avoid complex composites that look bad.
        // Replacing with a clean "Code" + "Search" overlay
        // Premium "Code Inspection" Logo: < 🔍 />
        // Carefully blocked out to ensure clean spacing and no overlapping mess.
        mainBtn.innerHTML = `
        <svg
            width="40" height="40"
            viewBox="-2 0 44 24"
            fill="none"
            stroke="white"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="filter: drop-shadow(0 2px 3px rgba(0,0,0,0.2));"
        >
            <defs>
                <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#e0e7ff;stop-opacity:1" />
                </linearGradient>
            </defs>
            <g stroke="url(#grad2)">
                <!-- Left angle bracket "<" -->
                <polyline points="6 6 3 12 6 18" />

                <!-- Magnifying glass circle (larger and centered) -->
                <circle cx="15" cy="12" r="5.5" />

                <!-- Magnifying glass handle -->
                <line x1="19" y1="16" x2="22" y2="19" />

                <!-- Slash "/" -->
                <line x1="27" y1="6" x2="25" y2="18" opacity="0.6" />

                <!-- Right angle bracket ">" -->
                <polyline points="31 6 34 12 31 18" />
            </g>
        </svg>`;
        mainBtn.style.display = 'flex';
        mainBtn.style.alignItems = 'center';
        mainBtn.style.justifyContent = 'center';
    }

    mainBtn.onclick = (e) => {
        e.stopPropagation();
        fabContainer.classList.toggle('open');
        if (modal!.style.display === 'flex') closeModal();
    };
    fabContainer.appendChild(mainBtn);

    // Escape Key Listener
    const escHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            if (isPicking) {
                stopPicking(false); // Cancel picking, no modal
            } else if (modal && modal.style.display === 'flex') {
                closeModal(); // Close modal, show FAB
            }
        }
    };
    document.addEventListener('keydown', escHandler);
    (window as any)._tagticsEscHandler = escHandler;

    shadowRoot.appendChild(fabContainer);

    // Modal
    modal = document.createElement('div');
    modal.className = 'tagtics-modal';

    const privacy = document.createElement('div');
    privacy.className = 'privacy-notice';
    privacy.innerText = config.privacyNotice || "We capture only the selected element's structure and styles. We never read or send form values, passwords, card numbers, or other typed personal information.";
    modal.appendChild(privacy);



    // Modal content dynamic
    // Modal content dynamic

    const desc = document.createElement('div');
    desc.className = 'element-desc';
    modal.appendChild(desc);

    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Enter feedback...';
    textarea.maxLength = 300;
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (textarea.value.trim().length > 0) {
                sendFeedback(textarea.value);
            }
        }
    });
    modal.appendChild(textarea);

    const charCounter = document.createElement('div');
    charCounter.className = 'char-counter';
    charCounter.textContent = '0 / 300';
    textarea.addEventListener('input', () => {
        const len = textarea.value.length;
        charCounter.textContent = `${len} / 300`;
        charCounter.style.color = len > 280 ? '#ff6b6b' : '#999';
    });
    modal.appendChild(charCounter);

    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '12px';

    const repickBtn = document.createElement('button');
    repickBtn.className = 'secondary';
    repickBtn.innerText = 'Re-pick';
    repickBtn.style.display = 'none'; // Hidden for page feedback
    repickBtn.onclick = () => {
        closeModal();
        startPicking();
    };
    buttonContainer.appendChild(repickBtn);

    const sendBtn = document.createElement('button');
    sendBtn.className = 'primary';
    sendBtn.innerText = 'Send';
    sendBtn.onclick = () => {
        sendFeedback(textarea.value);
    };
    buttonContainer.appendChild(sendBtn);

    modal.appendChild(buttonContainer);

    shadowRoot.appendChild(modal);
}

function destroy(): void {
    if (hostElement) {
        hostElement.remove();
        hostElement = null;
        shadowRoot = null;
        modal = null;
        overlay = null;
        selectedElement = null;
        if ((window as any)._tagticsHandlers) {
            stopPicking(false);
        }
        if ((window as any)._tagticsEscHandler) {
            document.removeEventListener('keydown', (window as any)._tagticsEscHandler);
            delete (window as any)._tagticsEscHandler;
        }
        // Clean up route listeners
        if ((window as any)._tagticsRouteListener) {
            window.removeEventListener('popstate', (window as any)._tagticsRouteListener);
            delete (window as any)._tagticsRouteListener;
        }
        // Restore original history methods
        if ((window as any)._tagticsOriginalPushState) {
            history.pushState = (window as any)._tagticsOriginalPushState;
            delete (window as any)._tagticsOriginalPushState;
        }
        if ((window as any)._tagticsOriginalReplaceState) {
            history.replaceState = (window as any)._tagticsOriginalReplaceState;
            delete (window as any)._tagticsOriginalReplaceState;
        }
    }
}

export default { init, open, destroy };
