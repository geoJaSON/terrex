import { useState } from "react";

interface BasemapSwitcherProps {
  current: string;
  onChange: (basemap: string) => void;
  options: string[];
}

const LABELS: Record<string, string> = {
  osm: "Streets",
  dark: "Dark",
  light: "Light",
  satellite: "Satellite",
};

const THUMBNAILS: Record<string, string> = {
  osm: "linear-gradient(135deg, #e8e8e8 0%, #c8d6c8 50%, #b8c8b8 100%)",
  dark: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
  light: "linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #d0d0d0 100%)",
  satellite: "linear-gradient(135deg, #1a3a1a 0%, #2d5a2d 50%, #1a4a3a 100%)",
};

export function BasemapSwitcher({
  current,
  onChange,
  options,
}: BasemapSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="basemap-switcher">
      {isOpen && (
        <div className="basemap-switcher__menu">
          {options.map((opt) => (
            <div
              key={opt}
              className={`basemap-switcher__option ${opt === current ? "basemap-switcher__option--active" : ""}`}
              style={{ background: THUMBNAILS[opt] || THUMBNAILS.dark }}
              data-label={LABELS[opt] || opt}
              onClick={() => {
                onChange(opt);
                setIsOpen(false);
              }}
            />
          ))}
        </div>
      )}
      <div
        className="basemap-switcher__toggle"
        style={{ background: THUMBNAILS[current] || THUMBNAILS.dark }}
        data-label={LABELS[current] || current}
        onClick={() => setIsOpen(!isOpen)}
      />
    </div>
  );
}
