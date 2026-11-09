/**
 * Decorative audio bars. Heights follow a fixed pseudo-random pattern so the
 * bar looks like a real waveform; when `active`, each bar animates with a
 * staggered delay to suggest speech.
 */
const BARS = 40

export function Waveform({ active }: { active: boolean }) {
  return (
    <div className="flex h-7 w-full items-center gap-[3px] px-1" aria-hidden>
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          className={`flex-1 origin-center rounded-full bg-black transition-opacity duration-300 ${
            active ? 'animate-wave opacity-80' : 'opacity-30'
          }`}
          style={{
            height: `${25 + ((i * 37) % 70)}%`,
            animationDelay: `${(i % 9) * 0.06}s`,
            animationDuration: `${0.55 + ((i * 7) % 5) * 0.08}s`,
          }}
        />
      ))}
    </div>
  )
}
