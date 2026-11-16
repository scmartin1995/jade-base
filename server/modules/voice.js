// Module manifest: see docs/EXTENDING.md.
export default {
  id: 'voice', name: 'Voice & wake word', icon: 'mic', order: 150,
  defaultOff: true,  // switched off until the user turns it on
  desc: 'Say the wake word to start a task hands-free. Runs in the browser; speech can be spoken back.',
};
