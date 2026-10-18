import { cloneRules, defaultRules, expectFormMacroForLander } from '../src/rules/rules';

describe('expectFormMacroForLander', () => {
  it('forces true for Preland w/ Form and false for Preland, and keeps the stored fallback otherwise', () => {
    expect(expectFormMacroForLander('Preland w/ Form', false)).toBe(true);
    expect(expectFormMacroForLander('Preland', true)).toBe(false);
    expect(expectFormMacroForLander('Preland w/ Form extra', false)).toBe(false);
    expect(expectFormMacroForLander('Preland w/ Form extra', true)).toBe(true);
    expect(expectFormMacroForLander('Offer', false)).toBe(false);
    expect(expectFormMacroForLander('Offer', true)).toBe(true);
    expect(expectFormMacroForLander('', true)).toBe(true);
    expect(expectFormMacroForLander(undefined, false)).toBe(false);
    expect(expectFormMacroForLander(null, true)).toBe(true);
  });

  it('does not treat the longer name as the shorter one and does not mutate the cloned admin rules', () => {
    const stored = defaultRules();
    stored.expectFormMacro = false;
    const rules = cloneRules(stored);
    rules.expectFormMacro = expectFormMacroForLander('Preland w/ Form', stored.expectFormMacro);
    expect(rules.expectFormMacro).toBe(true);
    expect(stored.expectFormMacro).toBe(false);
    expect(expectFormMacroForLander('Preland', stored.expectFormMacro)).toBe(false);
  });
});
