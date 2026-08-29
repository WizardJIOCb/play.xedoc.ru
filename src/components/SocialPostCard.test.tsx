import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerProvider } from '../player/PlayerContext'
import type { SocialComment, SocialPost } from '../types'
import { SocialPostCard } from './SocialPostCard'

const post: SocialPost = {
  id: 'post-comments',
  author: { username: 'listener', displayName: 'Music Listener' },
  body: 'Пост для обсуждения',
  visibility: 'public',
  attachments: [],
  createdAt: 1_700_000_000,
  likeCount: 0,
  commentCount: 3,
  liked: false,
  isOwner: true,
}

const trackPost: SocialPost = {
  ...post,
  id: 'post-track',
  body: '',
  attachments: [{
    kind: 'track',
    track: { id: 'shared-track', title: 'Shared track', artists: ['Artist'], durationMs: 180_000, streamUrl: '/api/public-search/tracks/shared-track/stream' },
  }],
  commentCount: 0,
}

const commentTree: SocialComment[] = [{
  id: 'root-comment',
  postId: post.id,
  author: { username: 'first', displayName: 'Первый' },
  body: 'Корневой комментарий',
  createdAt: 1_700_000_001,
  deleted: false,
  isOwner: false,
  replies: [{
    id: 'reply-comment',
    postId: post.id,
    parentId: 'root-comment',
    author: { username: 'second', displayName: 'Второй' },
    body: 'Ответ первого уровня',
    createdAt: 1_700_000_002,
    deleted: false,
    isOwner: false,
    replies: [{
      id: 'nested-comment',
      postId: post.id,
      parentId: 'reply-comment',
      author: { username: 'third', displayName: 'Третий' },
      body: 'Ответ второго уровня',
      createdAt: 1_700_000_003,
      deleted: false,
      isOwner: false,
      replies: [],
    }],
  }],
}]

const apiMocks = vi.hoisted(() => ({
  getSocialComments: vi.fn(),
  createSocialComment: vi.fn(),
}))

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  getSocialComments: apiMocks.getSocialComments,
  createSocialComment: apiMocks.createSocialComment,
}))

describe('SocialPostCard comments', () => {
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    apiMocks.getSocialComments.mockReset().mockResolvedValue(commentTree)
    apiMocks.createSocialComment.mockReset().mockResolvedValue(commentTree[0])
  })

  it('loads comments lazily and expands every reply level', async () => {
    render(<PlayerProvider><SocialPostCard post={post} readonly /></PlayerProvider>)
    expect(screen.queryByText('Корневой комментарий')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Комментарии: 3' }))
    expect(await screen.findByText('Корневой комментарий')).toBeInTheDocument()
    expect(screen.queryByText('Ответ первого уровня')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Показать ответы · 1' }))
    expect(screen.getByText('Ответ первого уровня')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Показать ответы · 1' }))
    expect(screen.getByText('Ответ второго уровня')).toBeInTheDocument()
  })

  it('publishes a root comment and refreshes the tree', async () => {
    render(<PlayerProvider><SocialPostCard post={post} /></PlayerProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Комментарии: 3' }))
    await screen.findByText('Корневой комментарий')
    fireEvent.change(screen.getByPlaceholderText('Оставить комментарий'), { target: { value: 'Новый комментарий' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))

    await waitFor(() => expect(apiMocks.createSocialComment).toHaveBeenCalledWith(post.id, 'Новый комментарий', undefined))
    await waitFor(() => expect(apiMocks.getSocialComments).toHaveBeenCalledTimes(2))
  })

  it('sends a reply to the selected comment', async () => {
    render(<PlayerProvider><SocialPostCard post={post} /></PlayerProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Комментарии: 3' }))
    await screen.findByText('Корневой комментарий')
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }))
    const replyComposer = screen.getByPlaceholderText('Ответить @first').closest<HTMLElement>('.comment-composer')
    expect(replyComposer).not.toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Ответить @first'), { target: { value: 'Ответ из интерфейса' } })
    fireEvent.click(within(replyComposer!).getByRole('button', { name: 'Отправить' }))

    await waitFor(() => expect(apiMocks.createSocialComment).toHaveBeenCalledWith(post.id, 'Ответ из интерфейса', 'root-comment'))
  })

  it('pauses a playing track attachment and restores its play icon', () => {
    const audio = document.createElement('audio')
    Object.defineProperty(audio, 'play', { value: vi.fn().mockResolvedValue(undefined) })
    Object.defineProperty(audio, 'pause', { value: vi.fn() })
    Object.defineProperty(audio, 'load', { value: vi.fn() })
    vi.stubGlobal('Audio', vi.fn(function AudioMock() { return audio }))
    render(<PlayerProvider><SocialPostCard post={trackPost} readonly /></PlayerProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Включить Shared track' }))
    const pauseButton = screen.getByRole('button', { name: 'Пауза Shared track' })
    expect(pauseButton.querySelector('.lucide-pause')).toBeInTheDocument()
    fireEvent.click(pauseButton)
    expect(screen.getByRole('button', { name: 'Включить Shared track' }).querySelector('.lucide-play')).toBeInTheDocument()
  })
})
