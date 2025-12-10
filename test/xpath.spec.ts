import { describe, it, expect } from 'vitest';
import { getXPath } from '../src/index';

describe('getXPath', () => {
    it('should return id-based xpath if id is present', () => {
        const div = document.createElement('div');
        div.id = 'my-id';
        document.body.appendChild(div);

        expect(getXPath(div)).toBe('//*[@id="my-id"]');
        div.remove();
    });

    it('should return absolute path for body', () => {
        expect(getXPath(document.body)).toBe('/html/body');
    });

    it('should return positional xpath for elements without id', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const span1 = document.createElement('span');
        const span2 = document.createElement('span');
        const div1 = document.createElement('div');

        container.appendChild(span1);
        container.appendChild(div1);
        container.appendChild(span2);

        // container path depends on previous tests/state, so let's just check the relative part or ensure isolation.
        // Since we append to body, it might be /html/body/div[1] etc.
        // Let's rely on the structure we just created.

        const containerPath = getXPath(container);
        expect(getXPath(span1)).toBe(containerPath + '/span[1]');
        expect(getXPath(div1)).toBe(containerPath + '/div[1]');
        expect(getXPath(span2)).toBe(containerPath + '/span[2]');

        container.remove();
    });
});
