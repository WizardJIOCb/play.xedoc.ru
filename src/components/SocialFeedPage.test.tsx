import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlayerProvider } from '../player/PlayerContext'
import type { SocialPost } from '../types'
import { SocialFeedPage } from './SocialFeedPage'

const fixture: SocialPost = {
  id: 'social-post-1',
  author: { username: 'listener', displayName: 'Music Listener' },
  body: 'Новый музыкальный дневник',
  visibility: 'public',
  attachments: [],
  createdAt: 1_700_000_000,
  likeCount: 0,
  commentCount: 0,
  liked: false,
  isOwner: true,
  rankingReason: 'Свежая запись',
}

const apiMocks = vi.hoisted(() => ({ getSocialFeed: vi.fn(), createSocialPost: vi.fn() }))
apiMocks.getSocialFeed.mockResolvedValue({ posts: [fixture], algorithm: 'xedoc-social-v1' })
apiMocks.createSocialPost.mockResolvedValue({ ...fixture, id: 'social-post-2', body: 'Вторая запись' })

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  getSocialFeed: apiMocks.getSocialFeed,
  createSocialPost: apiMocks.createSocialPost,
}))

describe('SocialFeedPage', () => {
  it('loads the personalized feed and publishes a post', async () => {
    render(<PlayerProvider><SocialFeedPage user={{ id: 'u1', username: 'listener', displayName: 'Music Listener', needsPassword: false, isAdmin: false }} tracks={[]} playlists={[]} /></PlayerProvider>)
    expect(await screen.findByText('Новый музыкальный дневник')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Что сейчас звучит, зацепило или случилось?'), { target: { value: 'Вторая запись' } })
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }))
    await waitFor(() => expect(apiMocks.createSocialPost).toHaveBeenCalledWith(expect.objectContaining({ body: 'Вторая запись', visibility: 'public' })))
    expect(await screen.findByText('Вторая запись')).toBeInTheDocument()
  })
})
