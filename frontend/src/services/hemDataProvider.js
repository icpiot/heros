import { mockHemState } from "../data/mockHemState.js";

export function createMockHemDataProvider() {
  return {
    getSnapshot() {
      return structuredClone(mockHemState);
    },
  };
}
