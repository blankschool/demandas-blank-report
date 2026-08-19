export function dateSortValue(value = "") {
  const part = (String(value).split(" → ")[0] || "").trim();
  const display = part.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (display) return `${display[3]}-${display[2]}-${display[1]}`;
  const iso = part.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
}

export function displayDateValue(value = "") {
  if (!value) return "—";
  const render = (part) => {
    const display = part.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (display) return `${display[1]}/${display[2]}/${display[3]}`;
    const iso = part.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : part;
  };
  const [start, end] = String(value).split(" → ");
  return end ? `${render(start)} → ${render(end)}` : render(start);
}

export function localCalendarKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
