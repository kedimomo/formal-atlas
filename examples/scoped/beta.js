// beta.js — defines its OWN `format`, but NOBODY calls it. It is dead.
// Before scope-aware resolution, alpha.js's `format(41)` made the merged
// `format` node look alive, hiding THIS dead routine (a false negative).
// The linker resolves alpha's call to alpha.js::format (local), so
// beta.js::format is correctly reported dead.
export function other() {
  return 2
}

function format(x) {
  return x * 2
}
