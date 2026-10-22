/** Wrangler's Text rule turns an .html import into a string. */
declare module '*.html' {
  const content: string;
  export default content;
}
