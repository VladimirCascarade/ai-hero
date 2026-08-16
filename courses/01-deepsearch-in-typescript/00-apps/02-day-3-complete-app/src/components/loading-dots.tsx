export const LoadingDots = () => {
  return (
    <span
      className="inline-flex items-center gap-1"
      aria-label="Generating title"
    >
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-bounce rounded-full bg-gray-400"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
};
