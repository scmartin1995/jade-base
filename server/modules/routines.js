// Module manifest: see docs/EXTENDING.md.
export default {
  id: 'routines', name: 'Routines', icon: 'clock', order: 140,
  defaultOff: true,  // switched off until the user turns it on
  desc: 'Everything that runs on a schedule or a button: routines, skill automations, agent schedules and Jade\'s own upkeep.',
  nav: [{ route: 'routines', label: 'Routines' }],
};
