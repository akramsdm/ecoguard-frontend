// Vitest setup file (loads before any test module, so React sees the flag at
// import time). The React 19 jsdom integration only wires act() when this
// environment flag is set; without it tests still run but act() warns.
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;