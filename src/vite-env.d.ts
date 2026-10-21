/// <reference types="vite/client" />

declare module "virtual:app-extension" {
  import type { AppExtension } from "./extensions";
  const extension: AppExtension;
  export default extension;
}
