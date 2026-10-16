// Vite's `?raw` imports: the file's text as a string (used for the Studio tab extension's files).
declare module '*?raw' {
  const text: string;
  export default text;
}
