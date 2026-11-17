import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME } from './index.js';

describe('core', () => {
  it('exports the product name', () => {
    expect(PRODUCT_NAME).toBe('Squadboard');
  });
});
