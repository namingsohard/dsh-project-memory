import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `.compat/` holds the per-version harness trees `.audit/compat-matrix.ps1`
    // builds, and each one carries a copy of `tests/`. Swept up by a root run
    // they execute against this checkout's dependencies rather than the line they
    // stand for, which turns a green suite into noise — ~300 files of it.
    exclude: [...configDefaults.exclude, '**/.compat/**'],
  },
})
