// next/font/google is a Next.js build-time loader: outside a Next build its exports are not callable, so a component
// that calls one at module scope cannot be imported by these tests ("Inter is not a function"). This stands in for it
// in vitest only (vitest.config.ts): every face answers with the class and variable names the component reads, and
// no font is fetched. The application and its build are unchanged.
type FontOptions = { variable?: string };
type FontResult = { className: string; variable: string; style: { fontFamily: string } };

function face(name: string) {
  return ({ variable }: FontOptions = {}): FontResult => ({
    className: `font-${name.toLowerCase()}`,
    variable: variable ? `font-variable${variable}` : '',
    style: { fontFamily: name },
  });
}

export const Inter = face('Inter');
