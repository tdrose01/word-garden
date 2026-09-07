// A small, gesture-unlocked sound palette. No media downloads or autoplay.
let context;
export function playGardenTone(kind, settings = {}, step = 0) {
  if (!settings.sound) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    context ||= new Audio();
    if (context.state === 'suspended') context.resume().catch(() => {});
    const notes = kind === 'level-complete' ? [523.25, 659.25, 783.99, 1046.5]
      : kind === 'target' || kind === 'bonus' || kind === 'planted' ? [523.25, 783.99]
      : kind === 'letter' ? [[261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99][step % 9]] : [];
    notes.forEach((frequency, index) => {
      const time = context.currentTime + index * .11;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, time);
      envelope.gain.setValueAtTime(0, time);
      envelope.gain.linearRampToValueAtTime(.045, time + .012);
      envelope.gain.exponentialRampToValueAtTime(.0001, time + .32);
      oscillator.connect(envelope); envelope.connect(context.destination);
      oscillator.start(time); oscillator.stop(time + .34);
      oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    });
  } catch { /* Audio support must never interrupt play. */ }
}
