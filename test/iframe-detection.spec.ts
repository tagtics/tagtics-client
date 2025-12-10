import { describe, it, expect } from 'vitest';
import { getEmbeds } from '../src/index';

describe('getEmbeds', () => {
    it('should detect iframes and return hostnames', () => {
        const iframe1 = document.createElement('iframe');
        iframe1.src = 'https://example.com/foo';
        document.body.appendChild(iframe1);

        const iframe2 = document.createElement('iframe');
        iframe2.src = 'https://other-domain.com/bar';
        document.body.appendChild(iframe2);

        const { hasEmbeds, embedHostnames } = getEmbeds();

        expect(hasEmbeds).toBe(true);
        expect(embedHostnames).toContain('example.com');
        expect(embedHostnames).toContain('other-domain.com');

        iframe1.remove();
        iframe2.remove();
    });

    it('should handle no embeds', () => {
        const { hasEmbeds, embedHostnames } = getEmbeds();
        expect(hasEmbeds).toBe(false);
        expect(embedHostnames.length).toBe(0);
    });
});
