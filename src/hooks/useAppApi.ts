import { useCallback } from "react";

import type { AppApi } from "../lib/contracts";

export function useAppApi(api: AppApi) {
  return useCallback(() => Promise.resolve(api), [api]);
}
