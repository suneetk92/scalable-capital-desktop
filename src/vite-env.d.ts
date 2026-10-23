/// <reference types="vite/client" />

declare module "virtual:app-extensions" {
  import type { AppExtension } from "./extensions";
  const extensions: AppExtension[];
  export default extensions;
}
