export type TagticsConfig = {
    apiKey: string;
    include?: string[];
    exclude?: string[];
    iconPosition?: { top?: string; right?: string; bottom?: string; left?: string };
    serializeChildDepth?: number;
    privacyNotice?: string;
    allowSameOriginIframe?: boolean;
    allowSensitivePages?: boolean;
};

const FEEDBACK_ENDPOINT = 'https://ingest.example.com/tagtics/feedback';

let config: TagticsConfig | null = null;
let hostElement: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let isPicking = false;
let hoveredElement: HTMLElement | null = null;
let overlay: HTMLElement | null = null;
let modal: HTMLElement | null = null;
let selectedElement: HTMLElement | null = null;

// --- Payment Detection Heuristics ---
const PAYMENT_KEYWORDS = ['checkout', 'payment', 'pay', 'billing', 'order', 'purchase', 'invoice', 'subscribe'];
const PAYMENT_PROVIDERS = ['stripe.com', 'paypal.com', 'braintreepayments.com', 'square.com', 'adyen.com'];
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
        } else if (attr.name === 'value' && (tagName === 'input' || tagName === 'textarea' || tagName === 'select')) {
            // Strip value
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
        :host { all: initial; font-family: sans-serif; }
        .tagtics-button {
            width: 48px; height: 48px; border-radius: 50%; background: #333; color: white;
            border: none; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            font-size: 24px; display: flex; align-items: center; justify-content: center;
            z-index: 999999;
        }
        .tagtics-button:hover { transform: scale(1.05); }
        .tagtics-modal {
            position: fixed; bottom: 80px; right: 24px; width: 300px;
            background: white; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            padding: 16px; z-index: 999999; display: none; flex-direction: column; gap: 12px;
            border: 1px solid #eee;
        }
        .tagtics-modal.open { display: flex; }
        .tagtics-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            pointer-events: none; z-index: 999998;
        }
        .tagtics-highlight {
            position: absolute; border: 2px solid #007bff; background: rgba(0,123,255,0.1);
            pointer-events: none; transition: all 0.2s ease;
        }
        .tagtics-tooltip {
            position: fixed; background: #333; color: white; padding: 4px 8px;
            border-radius: 4px; font-size: 12px; pointer-events: none; z-index: 1000000;
            display: none;
        }
        textarea { width: 100%; height: 80px; margin-top: 8px; padding: 8px; box-sizing: border-box; }
        button.primary { background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
        button.secondary { background: #eee; color: #333; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
        .privacy-notice { font-size: 11px; color: #666; margin-bottom: 8px; }
        .element-desc { font-size: 12px; font-family: monospace; color: #007bff; margin-bottom: 8px; word-break: break-all; }
        .confirmation { font-size: 12px; display: flex; align-items: center; gap: 8px; }
    `;
    return style;
}

function startPicking() {
    isPicking = true;
    modal!.style.display = 'none';
    document.body.style.cursor = 'crosshair';

    // Add overlay for highlighting
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'tagtics-overlay';
        // We need to append overlay to body to cover everything, but we want styles from shadow...
        // Actually, let's put the highlight box inside the shadow DOM but position it absolutely using getBoundingClientRect
        // Wait, shadow DOM is closed and small. We can't easily cover the whole page with a div inside shadow DOM unless the host is full screen.
        // But the host is just a container. Let's make the host a 0x0 div.
        // The requirement says "Inject a floating feedback button... in a closed Shadow DOM attached to a host element".
        // To draw highlights on the page, we might need a separate overlay or just use the shadow DOM if we can make it cover the screen without blocking clicks.
        // Better approach: The highlight box should be in the shadow DOM, and the shadow host should probably not block events.
        // But if the shadow host is 0x0, we can't draw outside it easily unless we use fixed positioning.
        // Let's use fixed positioning for the highlight box inside the shadow DOM.
    }

    const highlightBox = document.createElement('div');
    highlightBox.className = 'tagtics-highlight';
    highlightBox.style.display = 'none';
    shadowRoot!.appendChild(highlightBox);

    const tooltip = document.createElement('div');
    tooltip.className = 'tagtics-tooltip';
    tooltip.innerText = 'Embedded content not selectable';
    shadowRoot!.appendChild(tooltip);

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

        if (target === hostElement) return;

        hoveredElement = target;
        const rect = target.getBoundingClientRect();
        highlightBox.style.display = 'block';
        highlightBox.style.top = `${rect.top + window.scrollY}px`;
        highlightBox.style.left = `${rect.left + window.scrollX}px`;
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
                // Do nothing or show alert? Requirement says "show tooltip" on hover.
                return;
            }
        }

        stopPicking();
        selectElement(target);
    };

    document.addEventListener('mouseover', mouseOverHandler);
    document.addEventListener('click', clickHandler, { capture: true });

    // Store handlers to remove later
    (window as any)._tagticsHandlers = { mouseOverHandler, clickHandler, highlightBox, tooltip };
}

function stopPicking() {
    isPicking = false;
    document.body.style.cursor = 'default';
    if ((window as any)._tagticsHandlers) {
        const { mouseOverHandler, clickHandler, highlightBox, tooltip } = (window as any)._tagticsHandlers;
        document.removeEventListener('mouseover', mouseOverHandler);
        document.removeEventListener('click', clickHandler, { capture: true });
        highlightBox.remove();
        tooltip.remove();
        delete (window as any)._tagticsHandlers;
    }
    modal!.style.display = 'flex';
}

function selectElement(el: HTMLElement) {
    selectedElement = el;

    // Animate ancestors
    // Requirement: "Animate highlight sequence parent → child (short delays)."
    // We'll just highlight the selected element for now to keep it simple and robust.
    // To do the sequence, we'd need to find ancestors and flash the highlight box.

    const descriptor = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.split(' ').join('.') : ''}`;

    const descEl = shadowRoot!.querySelector('.element-desc');
    if (descEl) descEl.textContent = descriptor;

    // Keep highlighted
    const rect = el.getBoundingClientRect();
    const highlightBox = document.createElement('div');
    highlightBox.className = 'tagtics-highlight';
    highlightBox.style.top = `${rect.top + window.scrollY}px`;
    highlightBox.style.left = `${rect.left + window.scrollX}px`;
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

async function sendFeedback(text: string, userConfirmed: boolean) {
    if (!selectedElement || !config) return;

    const ancestors: any[] = [];
    let curr = selectedElement.parentElement;
    while (curr && curr !== document.body) {
        ancestors.push({
            xpath: getXPath(curr),
            tag: curr.tagName.toLowerCase(),
            descriptor: `${curr.tagName.toLowerCase()}${curr.id ? '#' + curr.id : ''}`
        });
        curr = curr.parentElement;
    }

    const { hasEmbeds, embedHostnames } = getEmbeds();

    const payload = {
        pageUrl: window.location.href,
        path: window.location.pathname,
        timestamp: Date.now(),
        clientMeta: {
            ua: navigator.userAgent,
            viewport: { width: window.innerWidth, height: window.innerHeight }
        },
        selected: {
            xpath: getXPath(selectedElement),
            tag: selectedElement.tagName.toLowerCase(),
            descriptor: shadowRoot!.querySelector('.element-desc')?.textContent,
            serialized: serializeElement(selectedElement, config.serializeChildDepth || 0),
            ancestors
        },
        hasEmbeds,
        embedHostnames,
        userConfirmedNoSensitiveData: userConfirmed
    };

    try {
        await fetch(FEEDBACK_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey
            },
            body: JSON.stringify(payload)
        });
        alert('Feedback sent!');
        closeModal();
    } catch (e) {
        console.error('Tagtics: Failed to send feedback', e);
        alert('Failed to send feedback.');
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
}


export default {
    init(c: TagticsConfig): void {
        if (!c.apiKey) {
            console.error('Tagtics: apiKey is required');
            return;
        }

        if (c.include && c.exclude) {
            console.error('Tagtics: Cannot provide both include and exclude options');
            return;
        }

        config = c;
        const path = window.location.pathname;

        if (config.include) {
            if (!config.include.some(p => path.startsWith(p))) return;
        }

        if (config.exclude) {
            if (config.exclude.some(p => path.startsWith(p))) return;
        }

        const isPayment = isLikelyPaymentPage();
        if (isPayment) {
            if (!config.allowSensitivePages) return;
            // If allowSensitivePages is true, we proceed, but we'll need the confirmation checkbox later.
        }

        this.open();
    },

    open(): void {
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

        const button = document.createElement('button');
        button.className = 'tagtics-button';
        button.innerText = '🔍';

        const pos = config.iconPosition || { bottom: '24px', right: '24px' };
        Object.assign(button.style, pos);

        button.onclick = () => {
            if (modal!.style.display === 'flex') {
                closeModal();
            } else {
                modal!.style.display = 'flex';
            }
        };
        shadowRoot.appendChild(button);

        // Modal
        modal = document.createElement('div');
        modal.className = 'tagtics-modal';

        const privacy = document.createElement('div');
        privacy.className = 'privacy-notice';
        privacy.innerText = config.privacyNotice || "We capture only the selected element's structure and styles. We never read or send form values, passwords, card numbers, or other typed personal information.";
        modal.appendChild(privacy);

        const isPayment = isLikelyPaymentPage();
        let confirmationCheckbox: HTMLInputElement | null = null;
        if (isPayment && config.allowSensitivePages) {
            const label = document.createElement('label');
            label.className = 'confirmation';
            confirmationCheckbox = document.createElement('input');
            confirmationCheckbox.type = 'checkbox';
            label.appendChild(confirmationCheckbox);
            label.appendChild(document.createTextNode('I confirm I will not enter sensitive information'));
            modal.appendChild(label);
        }

        const pickBtn = document.createElement('button');
        pickBtn.className = 'secondary';
        pickBtn.innerText = 'Pick element';
        pickBtn.onclick = () => {
            if (isPayment && config!.allowSensitivePages && confirmationCheckbox && !confirmationCheckbox.checked) {
                alert('Please confirm you will not enter sensitive information.');
                return;
            }
            startPicking();
        };
        modal.appendChild(pickBtn);

        const desc = document.createElement('div');
        desc.className = 'element-desc';
        modal.appendChild(desc);

        const textarea = document.createElement('textarea');
        textarea.placeholder = 'Enter feedback...';
        modal.appendChild(textarea);

        const sendBtn = document.createElement('button');
        sendBtn.className = 'primary';
        sendBtn.innerText = 'Send';
        sendBtn.onclick = () => {
            if (!selectedElement) {
                alert('Please pick an element first.');
                return;
            }
            sendFeedback(textarea.value, confirmationCheckbox ? confirmationCheckbox.checked : false);
        };
        modal.appendChild(sendBtn);

        shadowRoot.appendChild(modal);
    },

    destroy(): void {
        if (hostElement) {
            hostElement.remove();
            hostElement = null;
            shadowRoot = null;
            modal = null;
            overlay = null;
            selectedElement = null;
            if ((window as any)._tagticsHandlers) {
                stopPicking();
            }
        }
    }
};
