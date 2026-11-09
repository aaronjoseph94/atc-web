/** Decorative bars — CSS animates when active. */
export function Waveform({ active }: { active: boolean }) {
  return (
    <div className="flex h-7 w-full items-end gap-0.5 px-1" aria-hidden>
      {Array.from({ length: 36 }, (_, i) => (
        <span
          key={i}
          className={`flex-1 rounded-sm bg-black ${active ? 'animate-pulse' : 'opacity-40'}`}
          style={{
            height: `${20 + ((i * 37) % 70)}%`,
            animationDelay: `${(i % 8) * 0.07}s`,
            opacity: active ? 0.55 + ((i * 13) % 40) / 100 : 0.25,
          }}
        />
      ))}
    </div>
  )
}
