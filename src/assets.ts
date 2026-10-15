/** URL of a file in public/, correct under any deploy base (e.g. GitHub Pages' /<repo>/). */
export const asset = (name: string): string => `${import.meta.env.BASE_URL}${name}`;
