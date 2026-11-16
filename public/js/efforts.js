// How hard the model thinks, in plain words. The values are the levels Claude Code's /effort takes; '' sends none, so the model's own
// default applies. Used by Settings and by the first-run set-up.
export const EFFORT_CHOICES = [
  ['', "The model's own default"], ['low', 'Low (quickest)'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Maximum (slowest)'],
];
export const EFFORT_HELP = 'Higher is slower and uses more of your plan or budget. Left blank, the model decides for itself.';
export const effortOptions = (cur = '', blank = EFFORT_CHOICES[0][1]) =>
  EFFORT_CHOICES.map(([v, l]) => `<option value="${v}" ${(cur || '') === v ? 'selected' : ''}>${v === '' ? blank : l}</option>`).join('');
