// Theme: Jade's own built-in palette (Osaka Jade). The pages read it from /api/boot and set it as CSS variables.
export const JADE = {
  name: 'osaka-jade', mode: 'dark', accent: '#509475', selection: '#32473B', muted: '#53685B',
  background: '#111c18', dark_background: '#0c1512', darker_background: '#090f0d', lighter_background: '#23372B',
  foreground: '#C1C497', dark_foreground: '#81B8A8', light_foreground: '#D6D5BC', bright_foreground: '#F7E8B2',
  red: '#FF5345', yellow: '#E5C736', orange: '#a2734b', green: '#549e6a', cyan: '#2DD5B7', blue: '#509475', magenta: '#D2689C',
  bright_red: '#db9f9c', bright_green: '#63b07a', bright_cyan: '#8CD3CB', bright_blue: '#ACD4CF',
};

export function current() {
  return { ...JADE, source: 'built-in' };
}
