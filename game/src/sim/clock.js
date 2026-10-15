// Horloge de jeu. Le temps de jeu s'exprime en minutes depuis le début (jour 1, 00:00).
export const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

export class GameClock {
  constructor(startMinutes = 7 * 60) {
    this.minutes = startMinutes; // jour 1 à 7h00
    this.scale = 1;             // minutes de jeu par seconde réelle
    this.paused = false;
  }
  get day() { return Math.floor(this.minutes / 1440) + 1; }
  get minuteOfDay() { return this.minutes % 1440; }
  get hour() { return this.minuteOfDay / 60; }
  get dayOfWeek() { return (this.day - 1) % 7; }
  get dayName() { return DAY_NAMES[this.dayOfWeek]; }
  get isWeekend() { return this.dayOfWeek >= 5; }
  /** 0 = nuit noire, 1 = plein jour (courbe douce autour de l'aube et du crépuscule). */
  get daylight() {
    const h = this.hour;
    if (h < 5 || h >= 21.5) return 0;
    if (h < 7) return (h - 5) / 2;
    if (h < 19.5) return 1;
    return 1 - (h - 19.5) / 2;
  }
  get isNight() { const h = this.hour; return h >= 21 || h < 5.5; }
  get isEvening() { const h = this.hour; return h >= 18.5 && h < 21; }
  /** Angle solaire : 0 au lever (6h), PI au coucher (20h30). */
  get sunAngle() { return ((this.hour - 6) / 14.5) * Math.PI; }
  advance(dtMinutes) { this.minutes += dtMinutes; }
  format() {
    const m = Math.floor(this.minuteOfDay);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  /** Minutes jusqu'à la prochaine occurrence de l'heure h (0-24). */
  minutesUntil(h) {
    const target = h * 60;
    let d = target - this.minuteOfDay;
    if (d <= 0) d += 1440;
    return d;
  }
  toJSON() { return { minutes: this.minutes, scale: this.scale }; }
  load(o) { this.minutes = o.minutes; this.scale = o.scale ?? 1; }
}
