import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount/clear the DOM between tests (auto-cleanup only registers when vitest
// `globals` is on, which we keep off to match the explicit-import lib tests).
afterEach(() => cleanup());
