import 'vue';

/**
 * vue-i18n runs in legacy mode (global `$t` / `$i18n` injected into every
 * component). Declare them so vue-tsc type-checks SFC templates that use `$t`.
 */
declare module 'vue' {
  interface ComponentCustomProperties {
    $t: (key: string, named?: Record<string, unknown>) => string;
    $i18n: {
      locale: string;
      availableLocales: string[];
    };
  }
}

export {};
