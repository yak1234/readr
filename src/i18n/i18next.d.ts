// Chrome keys are typed from en.json: a misspelt key, or a label table naming a missing one, fails tsc.

import "i18next";
import type en from "./en.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
    returnNull: false;
  }
}
