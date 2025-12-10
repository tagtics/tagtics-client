import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isLikelyPaymentPage } from '../src/index';

describe('isLikelyPaymentPage', () => {
    const originalLocation = window.location;

    beforeEach(() => {
        // Reset DOM
        document.body.innerHTML = '';
        // Mock location
        delete (window as any).location;
        window.location = { ...originalLocation, href: 'http://example.com' } as any;
    });

    afterEach(() => {
        window.location = originalLocation;
    });

    it('should detect payment keywords in URL', () => {
        window.location.href = 'http://example.com/checkout';
        expect(isLikelyPaymentPage()).toBe(true);

        window.location.href = 'http://example.com/billing';
        expect(isLikelyPaymentPage()).toBe(true);
    });

    it('should detect sensitive inputs', () => {
        const input = document.createElement('input');
        input.name = 'cardnumber';
        document.body.appendChild(input);

        expect(isLikelyPaymentPage()).toBe(true);
    });

    it('should detect payment provider scripts', () => {
        const script = document.createElement('script');
        script.src = 'https://js.stripe.com/v3/';
        document.body.appendChild(script);

        expect(isLikelyPaymentPage()).toBe(true);
    });

    it('should return false for normal pages', () => {
        window.location.href = 'http://example.com/blog/post-1';
        expect(isLikelyPaymentPage()).toBe(false);
    });
});
