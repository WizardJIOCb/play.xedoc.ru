import type { BootstrapPayload, Playlist, Track } from '../types'

const demoCovers = {
  violet: '/demo-covers/violet.jpg',
  amber: '/demo-covers/amber.jpg',
  blue: '/demo-covers/blue.jpg',
  lime: '/demo-covers/lime.jpg',
  coral: '/demo-covers/coral.jpg',
  mono: '/demo-covers/mono.jpg',
} as const

const withDemoCover = (track: Track): Track => ({
  ...track,
  coverUrl: demoCovers[track.coverTone ?? 'mono'],
})

const demoTrackSeeds: Track[] = [
  { id: 'demo-1', title: 'Afterglow', artists: ['Northern Lines'], album: 'Soft Focus', durationMs: 238000, coverTone: 'lime', liked: true },
  { id: 'demo-2', title: 'Тёплый воздух', artists: ['Море внутри'], album: 'Август', durationMs: 203000, coverTone: 'coral' },
  { id: 'demo-3', title: 'Parallel', artists: ['Lumen Field'], album: 'Night Transit', durationMs: 266000, coverTone: 'blue', liked: true },
  { id: 'demo-4', title: 'Без слов', artists: ['Тихий дом'], album: 'Комнаты', durationMs: 192000, coverTone: 'mono' },
  { id: 'demo-5', title: 'Soft Machine', artists: ['Kite Assembly'], album: 'Motion Studies', durationMs: 221000, coverTone: 'violet' },
  { id: 'demo-6', title: 'Искры', artists: ['Северный свет'], album: 'Горизонт', durationMs: 247000, coverTone: 'amber', liked: true },
  { id: 'demo-7', title: 'Slow Bloom', artists: ['Archive Garden'], album: 'Open Windows', durationMs: 281000, coverTone: 'coral' },
  { id: 'demo-8', title: 'Пульс города', artists: ['Ночной рейс'], album: 'Неон', durationMs: 216000, coverTone: 'violet' },
  { id: 'demo-9', title: 'Half Awake', artists: ['Sunday Static'], album: 'Small Hours', durationMs: 234000, coverTone: 'blue' },
  { id: 'demo-10', title: 'Вне времени', artists: ['Линия берега'], album: 'Дальше', durationMs: 258000, coverTone: 'lime' },
]

export const demoTracks: Track[] = demoTrackSeeds.map(withDemoCover)

const playlist = (data: Omit<Playlist, 'tracks'> & { trackIds: number[] }): Playlist => ({
  ...data,
  coverUrl: demoCovers[data.coverTone ?? 'mono'],
  tracks: data.trackIds.map((index) => demoTracks[index]),
})

export const demoPlaylists: Playlist[] = [
  playlist({ id: 'p-1', title: 'Редкий фокус', subtitle: 'Спокойная электроника без вокала', trackCount: 42, durationMinutes: 164, coverTone: 'lime', accent: '#d9ff63', trackIds: [0, 2, 4, 6] }),
  playlist({ id: 'p-2', title: 'Ночной маршрут', subtitle: 'Для дороги после полуночи', trackCount: 31, durationMinutes: 118, coverTone: 'violet', accent: '#9f7aea', trackIds: [7, 2, 8, 4] }),
  playlist({ id: 'p-3', title: 'Новое рядом', subtitle: 'Свежие артисты на основе любимого', trackCount: 25, durationMinutes: 96, coverTone: 'blue', accent: '#57d3ff', trackIds: [1, 5, 9, 3] }),
  playlist({ id: 'p-4', title: 'Долго не включал', subtitle: 'Любимые треки, которые пора вернуть', trackCount: 38, durationMinutes: 149, coverTone: 'coral', accent: '#ff7a72', trackIds: [5, 0, 3, 6] }),
  playlist({ id: 'p-5', title: 'Мягкое утро', subtitle: 'Начать день без спешки', trackCount: 29, durationMinutes: 107, coverTone: 'amber', accent: '#ffbf5f', trackIds: [6, 1, 8, 0] }),
  playlist({ id: 'p-6', title: 'Без повторов', subtitle: 'Ничего из последних 30 дней', trackCount: 50, durationMinutes: 193, coverTone: 'mono', accent: '#c9cbd2', trackIds: [9, 4, 1, 7] }),
]

export const demoBootstrap: BootstrapPayload = {
  connected: false,
  demo: true,
  catalogAvailable: false,
  accessLocked: false,
  authenticated: false,
  quickTracks: demoTracks.slice(0, 6),
  likedTracks: demoTracks.filter((track) => track.liked),
  likedCount: demoTracks.filter((track) => track.liked).length,
  playlists: demoPlaylists.slice(0, 4),
  recommendations: demoPlaylists.slice(1, 6),
  rediscover: [demoTracks[5], demoTracks[0], demoTracks[3], demoTracks[8]],
  localPlaylists: [],
  xedocRecommendations: [],
  recommendationInsight: 'Подключите коллекцию — рекомендации XEDOC будут учиться на прослушиваниях.',
  xedocCollections: [],
}
