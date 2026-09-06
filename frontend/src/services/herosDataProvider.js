import { mockHerosState } from "../data/mockHerosState.js";

export function createMockHerosDataProvider() {
  return {
    getSnapshot() {
      return structuredClone(mockHerosState);
    },
  };
}
