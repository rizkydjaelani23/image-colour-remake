export {};

declare global {
  interface Window {
    shopify: typeof shopify;
  }

  const shopify: {
    resourcePicker: (options: {
      type: "product" | "variant" | "collection";
      action?: "select";
      multiple?: boolean;
      filter?: {
        hidden?: boolean;
        variants?: boolean;
        archived?: boolean;
        draft?: boolean;
      };
      selectionIds?: Array<{ id: string }>;
    }) => Promise<
      Array<{
        id: string;
        title: string;
      }>
    >;
  };
}