const FOOTER_KEY = 'footerLogo';
const teamKey = id => `teamLogo:${id}`;

export const getFooterLogo = () => localStorage.getItem(FOOTER_KEY);
export const setFooterLogo = dataUrl => localStorage.setItem(FOOTER_KEY, dataUrl);
export const getTeamLogo = id => localStorage.getItem(teamKey(id));
export const setTeamLogo = (id, dataUrl) => localStorage.setItem(teamKey(id), dataUrl);
const teamNameKey = id => `teamName:${id}`;
export const getTeamName = id => localStorage.getItem(teamNameKey(id));
export const setTeamName = (id, name) => name ? localStorage.setItem(teamNameKey(id), name) : localStorage.removeItem(teamNameKey(id));

export function readImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return Promise.reject(new Error('Нужен файл картинки.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.readAsDataURL(file);
  });
}

export async function storeImage(file, save) {
  const url = await readImageFile(file);
  try {
    save(url);
  } catch {
    throw new Error('Не удалось сохранить логотип: файл слишком большой.');
  }
}
