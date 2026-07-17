import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

import { cn } from '../../../../lib/utils'
import type { DocToolbarPosition, EditorApi } from '../../types/editor'
import { DocToolbar } from '../DocToolbar/DocToolbar'
import { DocQuickStart } from '../DocPage/DocQuickStart'
import { DocEditorMentionPicker } from '../Mentions/DocEditorMentionPicker'
import { DocBannerChrome, createBannerHtml, getBannerBlock } from './DocBannerChrome'
import { DocCreateTaskBar, type CreateTaskBarPosition } from './DocCreateTaskBar'
import { DocSelectionBubble, type BubblePosition, type SelectionSnapshot } from './DocSelectionBubble'
import { InsertLinkDialog } from './InsertLinkDialog'

const TOOLBAR_POS_KEY = 'flowdesk.docs.toolbarPosition'
const BUBBLE_HEIGHT = 44
const BUBBLE_GAP = 8

function readToolbarPosition(): DocToolbarPosition {
  try {
    return localStorage.getItem(TOOLBAR_POS_KEY) === 'top' ? 'top' : 'floating'
  } catch {
    return 'floating'
  }
}

function isBlankHtml(html: string): boolean {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() === ''
}

function selectionRect(): DOMRect | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return rect
}

function bubblePositionFromRect(rect: DOMRect): BubblePosition {
  // Prefer above the selection; flip below only when there isn't room.
  const above = rect.top - BUBBLE_HEIGHT - BUBBLE_GAP
  const top = above >= 8 ? above : rect.bottom + BUBBLE_GAP
  return {
    top: Math.min(top, window.innerHeight - BUBBLE_HEIGHT - 8),
    left: rect.left + rect.width / 2,
  }
}
import {
  detectDocMentionTrigger,
  getTextBeforeCaret,
  mentionChipHtml,
  replaceBeforeCaret,
  type DocMentionTrigger,
} from '../Mentions/docEditorMention'
import { DocBlockChrome } from './DocBlockChrome'
import {
  createCodeBlockHtml,
  getCodeBlock,
  isCaretAtEndOfCodeBlock,
  placeCaretAfterCodeBlock,
  trimTrailingEmptyCodeLine,
  wrapOrphanPres,
} from './docCodeBlock'
import { getBlockType, getEditorBlock } from './docEditorBlocks'
import { createImageBlockHtml, getImageBlock, wrapOrphanImages } from './docImageBlock'
import {
  createTableBlockHtml,
  getTableBlock,
  normalizeTableBlocks,
  wrapOrphanTables,
} from './docTableBlock'

interface DocEditorProps {
  /** Changing this resets the editor DOM (used when navigating between docs). */
  docId: string
  initialContent: string
  onChange: (html: string) => void
  placeholder?: string
  /** Archived documents render read-only (no toolbar, not editable). */
  readOnly?: boolean
  /** When true, selected text can be commented inline. */
  canComment?: boolean
  /** Called after wrapping the selection in a comment marker. */
  onInlineComment?: (quote: string, markerId: string) => void
  /** User clicked an existing inline comment marker. */
  onMarkerClick?: (markerId: string) => void
  /** Fired when a people @mention chip is inserted (flush save / notify). `html` is editor content after insert. */
  onPeopleMentioned?: (userId: string, html: string) => void
  /** Fired when the local caret moves (for remote cursor broadcast). */
  onCaretChange?: (offset: number) => void
  /** Extra classes for the editable region (e.g. page width). */
  contentClassName?: string
  /** Focus mode — dims chrome around the editor. */
  focusClassName?: string
  /** When false, formatting toolbar is rendered by the parent. */
  showToolbar?: boolean
  /** Parent-controlled sticky toolbar visibility (`top` shows sticky bar). */
  toolbarPosition?: DocToolbarPosition
  onToolbarPositionChange?: (value: DocToolbarPosition) => void
  /** Create a linked subpage using the current selection as the title. */
  onCreateSubpage?: (title: string) => void | Promise<void>
  /** Shown inside the editor when the page has no body text yet. */
  onQuickStartMention?: () => void
  onApiReady?: (api: EditorApi) => void
}

export type DocEditorHandle = EditorApi

/**
 * Rich text editor built on `contentEditable` + `execCommand`. Uncontrolled by
 * design: the DOM is the source of truth while editing and we emit HTML on every
 * change (the page debounces it into auto-save). Native browser undo/redo and
 * Ctrl+B/I/U shortcuts work out of the box.
 */
export default forwardRef<DocEditorHandle, DocEditorProps>(function DocEditor(
  {
    docId,
    initialContent,
    onChange,
    placeholder,
    readOnly = false,
    canComment = false,
    onInlineComment,
    onMarkerClick,
    onPeopleMentioned,
    onCaretChange,
    contentClassName,
    focusClassName,
    showToolbar = true,
    toolbarPosition: toolbarPositionProp,
    onToolbarPositionChange,
    onCreateSubpage,
    onQuickStartMention,
    onApiReady,
  },
  editorApiRef,
) {
  const editorRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const applyingRemote = useRef(false)
  const savedTaskRange = useRef<Range | null>(null)
  const savedLinkRange = useRef<Range | null>(null)
  const savedLinkSelection = useRef('')
  /** Sync flag so selectionchange/refresh cannot dismiss the composer mid-open. */
  const taskComposerOpenRef = useRef(false)
  const [selectionBubble, setSelectionBubble] = useState<BubblePosition | null>(null)
  const [createTaskDraft, setCreateTaskDraft] = useState<{
    title: string
    position: CreateTaskBarPosition
  } | null>(null)
  const [linkDialog, setLinkDialog] = useState<{ open: boolean; defaultUrl: string; selectedText: string }>({
    open: false,
    defaultUrl: '',
    selectedText: '',
  })
  const [isEmpty, setIsEmpty] = useState(() => isBlankHtml(initialContent))
  const [localToolbarPos, setLocalToolbarPos] = useState<DocToolbarPosition>(readToolbarPosition)
  const toolbarPosition = toolbarPositionProp ?? localToolbarPos

  const setToolbarPosition = useCallback(
    (value: DocToolbarPosition) => {
      try {
        localStorage.setItem(TOOLBAR_POS_KEY, value)
      } catch {
        /* ignore */
      }
      setLocalToolbarPos(value)
      onToolbarPositionChange?.(value)
    },
    [onToolbarPositionChange],
  )
  const [mentionTrigger, setMentionTrigger] = useState<DocMentionTrigger | null>(null)
  const [mentionHighlight, setMentionHighlight] = useState(0)
  const [activeBlock, setActiveBlock] = useState<{
    el: HTMLElement
    type: 'table' | 'image' | 'code' | 'banner'
  } | null>(null)

  const syncEmpty = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    const empty = el.textContent?.trim() === '' && !el.querySelector('img,hr,table,li,.doc-editor-block')
    el.setAttribute('data-empty', empty ? 'true' : 'false')
  }, [])

  const getCaretOffset = useCallback(() => {
    const el = editorRef.current
    if (!el) return 0
    return getTextBeforeCaret(el).length
  }, [])

  const setCaretOffset = useCallback((offset: number) => {
    const el = editorRef.current
    if (!el) return
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let remaining = Math.max(0, offset)
    let node: Node | null = walker.nextNode()
    while (node) {
      const len = node.textContent?.length ?? 0
      if (remaining <= len) {
        const range = document.createRange()
        range.setStart(node, remaining)
        range.collapse(true)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        return
      }
      remaining -= len
      node = walker.nextNode()
    }
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }, [])

  const emit = useCallback(() => {
    if (applyingRemote.current) return
    const el = editorRef.current
    if (!el) return
    normalizeTableBlocks(el)
    syncEmpty()
    const html = el.innerHTML
    setIsEmpty(isBlankHtml(html))
    onChange(html)
  }, [onChange, syncEmpty])

  const applyRemoteContent = useCallback(
    (html: string) => {
      const el = editorRef.current
      if (!el) return
      if (el.innerHTML === html) return
      const hadFocus = document.activeElement === el
      const offset = hadFocus ? getCaretOffset() : 0
      applyingRemote.current = true
      try {
        el.innerHTML = html
        wrapOrphanTables(el)
        wrapOrphanImages(el)
        wrapOrphanPres(el)
        syncEmpty()
        if (hadFocus) {
          // Restore approximate caret so remote sync doesn't feel like a full remount.
          el.focus({ preventScroll: true })
          setCaretOffset(offset)
        }
      } finally {
        applyingRemote.current = false
      }
    },
    [getCaretOffset, setCaretOffset, syncEmpty],
  )

  // Load content when the document changes (not on every keystroke — that would
  // reset the caret). The DOM owns state between loads.
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    el.innerHTML = initialContent
    wrapOrphanTables(el)
    wrapOrphanImages(el)
    wrapOrphanPres(el)
    syncEmpty()
    setIsEmpty(isBlankHtml(initialContent))
    taskComposerOpenRef.current = false
    setCreateTaskDraft(null)
    setSelectionBubble(null)
    setActiveBlock(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  const run = useCallback(
    (command: string, value?: string) => {
      editorRef.current?.focus()
      document.execCommand(command, false, value)
      emit()
    },
    [emit],
  )

  const insertHTML = useCallback((html: string) => run('insertHTML', html), [run])

  const inlineCode = useCallback(() => {
    const sel = window.getSelection()
    const text = sel?.toString()
    if (text) insertHTML(`<code>${escapeHtml(text)}</code>`)
    else insertHTML('<code>code</code>')
  }, [insertHTML])

  const link = useCallback(() => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      savedLinkRange.current = sel.getRangeAt(0).cloneRange()
    } else {
      savedLinkRange.current = null
    }
    const selectedText = sel && !sel.isCollapsed ? sel.toString().trim() : ''
    savedLinkSelection.current = selectedText
    const anchor =
      sel?.anchorNode instanceof Element
        ? sel.anchorNode
        : sel?.anchorNode?.parentElement ?? null
    const existing = anchor?.closest('a')?.getAttribute('href') ?? ''
    setLinkDialog({ open: true, defaultUrl: existing, selectedText })
    setSelectionBubble(null)
  }, [])

  const applyLink = useCallback(
    (rawUrl: string) => {
      const url = normalizeUrl(rawUrl)
      const el = editorRef.current
      if (el) {
        el.focus({ preventScroll: true })
        const range = savedLinkRange.current
        if (range) {
          const sel = window.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(range)
        }
      }
      const selectedText = savedLinkSelection.current
      if (selectedText) run('createLink', url)
      else insertHTML(`<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`)
      savedLinkRange.current = null
      savedLinkSelection.current = ''
    },
    [insertHTML, run],
  )

  const codeBlock = useCallback(() => {
    const el = editorRef.current
    if (el) {
      const anchor = document.getSelection()?.anchorNode ?? null
      const anchorEl = anchor instanceof Element ? anchor : anchor?.parentElement ?? null
      const existing = getCodeBlock(anchorEl)
      if (existing) {
        placeCaretAfterCodeBlock(existing)
        emit()
        return
      }
    }
    const text = window.getSelection()?.toString() ?? ''
    insertHTML(createCodeBlockHtml(text))
    // Caret usually lands after the trailing <p>; move into the new code block.
    requestAnimationFrame(() => {
      const editor = editorRef.current
      if (!editor) return
      const blocks = editor.querySelectorAll('.doc-code-block')
      const latest = blocks[blocks.length - 1]
      if (!(latest instanceof HTMLElement)) return
      const target = latest.querySelector('code') ?? latest.querySelector('pre') ?? latest
      const range = document.createRange()
      range.selectNodeContents(target)
      range.collapse(text.trim().length > 0 ? false : true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      setActiveBlock({ el: latest, type: 'code' })
    })
  }, [emit, insertHTML])

  const image = useCallback(() => fileRef.current?.click(), [])

  const onFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const src = String(reader.result)
        insertHTML(createImageBlockHtml(src, file.name))
      }
      reader.readAsDataURL(file)
    },
    [insertHTML],
  )

  const placeCaretAfterBlock = useCallback((block: HTMLElement) => {
    const p = document.createElement('p')
    p.innerHTML = '<br>'
    block.insertAdjacentElement('afterend', p)
    const range = document.createRange()
    range.setStart(p, 0)
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }, [])

  const table = useCallback(() => {
    const el = editorRef.current
    if (el) {
      const anchor = document.getSelection()?.anchorNode ?? null
      const anchorEl = anchor instanceof Element ? anchor : anchor?.parentElement ?? null
      const tableBlock = getTableBlock(anchorEl)
      if (tableBlock) placeCaretAfterBlock(tableBlock)
    }
    insertHTML(createTableBlockHtml())
  }, [insertHTML, placeCaretAfterBlock])

  const columns = useCallback(() => {
    insertHTML(
      '<div class="doc-columns"><div class="doc-column"><p><br></p></div><div class="doc-column"><p><br></p></div></div><p><br></p>',
    )
  }, [insertHTML])

  const taskList = useCallback(() => {
    insertHTML(
      '<ul class="doc-checklist"><li data-checked="false">Task 1</li><li data-checked="false">Task 2</li><li data-checked="false">Task 3</li></ul><p><br></p>',
    )
  }, [insertHTML])

  const subpage = useCallback(
    (documentId: string, title: string) => {
      const safeTitle = escapeHtml(title || 'Untitled')
      insertHTML(
        `<div class="doc-subpage" data-doc-id="${escapeAttr(documentId)}" contenteditable="false"><a href="/app/docs/${escapeAttr(documentId)}">📄 ${safeTitle}</a></div><p><br></p>`,
      )
    },
    [insertHTML],
  )

  const focusEditor = useCallback(() => {
    const el = editorRef.current
    el?.focus()
    if (el && typeof window.getSelection !== 'undefined') {
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }, [])

  const checklist = useCallback(
    () => insertHTML('<ul class="doc-checklist"><li data-checked="false">To-do</li></ul>'),
    [insertHTML],
  )

  const foreColor = useCallback(
    (color: string) => {
      try {
        document.execCommand('styleWithCSS', false, 'true')
      } catch {
        /* optional */
      }
      run('foreColor', color)
    },
    [run],
  )

  const hiliteColor = useCallback(
    (color: string) => {
      try {
        document.execCommand('styleWithCSS', false, 'true')
      } catch {
        /* optional */
      }
      // Prefer hiliteColor; fall back to backColor for older engines.
      editorRef.current?.focus()
      if (!document.execCommand('hiliteColor', false, color)) {
        document.execCommand('backColor', false, color)
      }
      emit()
    },
    [emit],
  )

  const badge = useCallback(
    (color: string) => {
      const sel = window.getSelection()
      const text = sel?.toString() || 'badge'
      insertHTML(
        `<span class="doc-badge" style="background:${escapeAttr(color)};color:#fff">${escapeHtml(text)}</span>&nbsp;`,
      )
    },
    [insertHTML],
  )

  const removeColor = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    editorRef.current?.focus()
    try {
      document.execCommand('styleWithCSS', false, 'true')
    } catch {
      /* optional */
    }
    document.execCommand('foreColor', false, 'inherit')
    if (!document.execCommand('hiliteColor', false, 'transparent')) {
      document.execCommand('backColor', false, 'transparent')
    }
    // Unwrap badge chips inside the selection.
    const range = sel.getRangeAt(0)
    const root = range.commonAncestorContainer
    const host = root instanceof Element ? root : root.parentElement
    host
      ?.closest('.docs-content')
      ?.querySelectorAll('span.doc-badge')
      .forEach((el) => {
        if (!range.intersectsNode(el)) return
        const parent = el.parentNode
        if (!parent) return
        while (el.firstChild) parent.insertBefore(el.firstChild, el)
        parent.removeChild(el)
      })
    emit()
  }, [emit])

  const banner = useCallback(
    (variant: Parameters<EditorApi['banner']>[0], tone: Parameters<EditorApi['banner']>[1] = 'solid') => {
      const text = window.getSelection()?.toString().trim() || 'Banner'
      insertHTML(createBannerHtml(variant, text, '🚩', tone ?? 'solid'))
      // Activate chrome on the newly inserted banner (matches reference callout UX).
      requestAnimationFrame(() => {
        const el = editorRef.current
        if (!el) return
        const banners = el.querySelectorAll('.doc-banner')
        const latest = banners[banners.length - 1]
        if (latest instanceof HTMLElement) setActiveBlock({ el: latest, type: 'banner' })
      })
    },
    [insertHTML],
  )

  const align = useCallback(
    (value: 'left' | 'center' | 'right' | 'justify') => {
      const cmd =
        value === 'center'
          ? 'justifyCenter'
          : value === 'right'
            ? 'justifyRight'
            : value === 'justify'
              ? 'justifyFull'
              : 'justifyLeft'
      run(cmd)
    },
    [run],
  )

  const indent = useCallback(() => run('indent'), [run])
  const outdent = useCallback(() => run('outdent'), [run])
  const clearFormat = useCallback(() => run('removeFormat'), [run])

  const syncMention = useCallback(() => {
    const el = editorRef.current
    if (!el || readOnly) return
    const before = getTextBeforeCaret(el)
    const next = detectDocMentionTrigger(before)
    setMentionTrigger(next)
    if (next) setMentionHighlight(0)
  }, [readOnly])

  const insertAt = useCallback(() => {
    insertHTML('@')
    setMentionTrigger({ tab: 'people', query: '', triggerText: '@' })
    setMentionHighlight(0)
  }, [insertHTML])

  const api = useMemo<EditorApi>(
    () => ({
      undo: () => run('undo'),
      redo: () => run('redo'),
      paragraph: () => run('formatBlock', 'p'),
      heading: (level) => run('formatBlock', `h${level}`),
      bold: () => run('bold'),
      italic: () => run('italic'),
      underline: () => run('underline'),
      strike: () => run('strikeThrough'),
      bulletList: () => run('insertUnorderedList'),
      numberList: () => run('insertOrderedList'),
      checklist,
      quote: () => run('formatBlock', 'blockquote'),
      banner,
      inlineCode,
      codeBlock,
      link,
      image,
      table,
      divider: () => run('insertHorizontalRule'),
      columns,
      taskList,
      subpage,
      foreColor,
      hiliteColor,
      badge,
      removeColor,
      align,
      indent,
      outdent,
      clearFormat,
      focus: focusEditor,
      insertAt,
      applyRemoteContent,
      getCaretOffset,
    }),
    [
      run,
      checklist,
      banner,
      inlineCode,
      codeBlock,
      link,
      image,
      table,
      columns,
      taskList,
      subpage,
      foreColor,
      hiliteColor,
      badge,
      removeColor,
      align,
      indent,
      outdent,
      clearFormat,
      focusEditor,
      insertAt,
      applyRemoteContent,
      getCaretOffset,
    ],
  )

  useImperativeHandle(editorApiRef, () => api, [api])

  useEffect(() => {
    onApiReady?.(api)
  }, [api, onApiReady])

  const selectBlock = useCallback((target: EventTarget | null) => {
    const node = target as HTMLElement | null
    const bannerBlock = getBannerBlock(node)
    if (bannerBlock) {
      setActiveBlock({ el: bannerBlock, type: 'banner' })
      return true
    }
    const block = getEditorBlock(node) ?? getTableBlock(node) ?? getImageBlock(node) ?? getCodeBlock(node)
    if (!block) {
      setActiveBlock(null)
      return false
    }
    const type = getBlockType(block)
    if (type) setActiveBlock({ el: block, type })
    return true
  }, [])

  // Toggle checklist items by clicking their marker (left ~24px of the row).
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const mark = (e.target as HTMLElement).closest('mark[data-doc-comment]')
      if (mark) {
        const id = mark.getAttribute('data-doc-comment')
        if (id) onMarkerClick?.(id)
        return
      }

      if (selectBlock(e.target)) return

      if (readOnly) return
      const li = (e.target as HTMLElement).closest('li')
      if (!li || !li.parentElement?.classList.contains('doc-checklist')) return
      const rect = li.getBoundingClientRect()
      if (e.clientX - rect.left > 24) return
      li.setAttribute('data-checked', li.getAttribute('data-checked') === 'true' ? 'false' : 'true')
      emit()
    },
    [emit, readOnly, onMarkerClick, selectBlock],
  )

  const updateSelectionBubble = useCallback(() => {
    if (readOnly || taskComposerOpenRef.current) {
      setSelectionBubble(null)
      return
    }
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !editorRef.current?.contains(sel.anchorNode)) {
      setSelectionBubble(null)
      return
    }
    const text = sel.toString().trim()
    if (!text) {
      setSelectionBubble(null)
      return
    }
    const rect = selectionRect()
    if (!rect) {
      setSelectionBubble(null)
      return
    }
    setSelectionBubble(bubblePositionFromRect(rect))
  }, [readOnly])

  useEffect(() => {
    if (readOnly) return
    const onSelectionChange = () => {
      if (taskComposerOpenRef.current) return
      const sel = window.getSelection()
      if (!sel || !editorRef.current) return
      if (!sel.isCollapsed && editorRef.current.contains(sel.anchorNode)) {
        updateSelectionBubble()
      } else if (sel.isCollapsed) {
        setSelectionBubble(null)
      }
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [readOnly, updateSelectionBubble])

  const openCreateTask = useCallback((snapshot: SelectionSnapshot) => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      savedTaskRange.current = sel.getRangeAt(0).cloneRange()
    }
    taskComposerOpenRef.current = true
    setSelectionBubble(null)
    setCreateTaskDraft({
      title: snapshot.text,
      position: {
        selectionTop: snapshot.top,
        selectionBottom: snapshot.bottom,
        selectionCenterX: snapshot.centerX,
        selectionWidth: snapshot.width,
      },
    })
  }, [])

  const createSubpageFromSelection = useCallback(
    (snapshot: SelectionSnapshot) => {
      void onCreateSubpage?.(snapshot.text)
    },
    [onCreateSubpage],
  )

  const focusEditorStart = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }, [])

  const addInlineComment = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const text = sel.toString().trim()
    if (!text) return
    const markerId =
      typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `m-${Date.now()}`
    const range = sel.getRangeAt(0)
    const mark = document.createElement('mark')
    mark.className = 'doc-comment-marker'
    mark.setAttribute('data-doc-comment', markerId)
    try {
      range.surroundContents(mark)
    } catch {
      mark.textContent = text
      range.deleteContents()
      range.insertNode(mark)
    }
    setSelectionBubble(null)
    sel.removeAllRanges()
    emit()
    onInlineComment?.(text, markerId)
  }, [emit, onInlineComment])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mentionTrigger) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setMentionTrigger(null)
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setMentionHighlight((i) => i + 1)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setMentionHighlight((i) => Math.max(0, i - 1))
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          window.dispatchEvent(
            new CustomEvent('doc-mention-confirm', { detail: { index: mentionHighlight } }),
          )
          return
        }
      }

      const anchor = document.getSelection()?.anchorNode ?? null
      const anchorEl = anchor instanceof Element ? anchor : anchor?.parentElement ?? null
      const codeBlk = getCodeBlock(anchorEl)

      if (codeBlk && !readOnly) {
        // Cmd/Ctrl+Enter always exits. Enter on a trailing blank line also exits
        // so you are not stuck inside the block; Shift+Enter keeps a normal newline.
        if (e.key === 'Enter') {
          const modExit = e.metaKey || e.ctrlKey
          const atEnd = isCaretAtEndOfCodeBlock(codeBlk)
          const raw = (codeBlk.innerText || '').replace(/\u00a0/g, ' ')
          const trailingBlank = atEnd && (raw.trim() === '' || /\n\s*$/.test(raw))
          if (modExit || (!e.shiftKey && trailingBlank)) {
            e.preventDefault()
            if (!modExit) trimTrailingEmptyCodeLine(codeBlk)
            placeCaretAfterCodeBlock(codeBlk)
            setActiveBlock(null)
            emit()
            return
          }
        }
        if (e.key === 'Backspace') {
          const text = (codeBlk.innerText || '').replace(/\u00a0/g, ' ').trim()
          if (!text && isCaretAtEndOfCodeBlock(codeBlk)) {
            e.preventDefault()
            const prev = codeBlk.previousElementSibling
            codeBlk.remove()
            setActiveBlock(null)
            if (prev instanceof HTMLElement) {
              const range = document.createRange()
              range.selectNodeContents(prev)
              range.collapse(false)
              const sel = window.getSelection()
              sel?.removeAllRanges()
              sel?.addRange(range)
            }
            emit()
            return
          }
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        link()
      }
    },
    [link, mentionTrigger, mentionHighlight, readOnly, emit],
  )

  const pickMention = useCallback(
    (tab: DocMentionTrigger['tab'], id: string, label: string, href?: string) => {
      const el = editorRef.current
      if (!el || !mentionTrigger) return
      const display =
        tab === 'people'
          ? id === 'all'
            ? '@All'
            : `@${label}`
          : tab === 'tasks'
            ? `#${label}`
            : tab === 'channels'
              ? `#${label}`
              : tab === 'locations'
                ? `@/${label}`
                : tab === 'whiteboards'
                  ? `📋 ${label}`
                  : `📄 ${label}`
      replaceBeforeCaret(el, mentionTrigger.triggerText.length, mentionChipHtml(tab, id, display, href))
      setMentionTrigger(null)
      const nextHtml = el.innerHTML
      // Sync parent contentRef immediately so body-mentions gets the chip HTML.
      onChange(nextHtml)
      syncEmpty()
      if (tab === 'people') onPeopleMentioned?.(id, nextHtml)
    },
    [mentionTrigger, onChange, onPeopleMentioned, syncEmpty],
  )

  const reportCaret = useCallback(() => {
    if (readOnly) return
    onCaretChange?.(getCaretOffset())
  }, [readOnly, onCaretChange, getCaretOffset])

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', focusClassName)}>
      {!readOnly && showToolbar && toolbarPosition === 'top' && <DocToolbar api={api} />}
      <div className="relative min-h-[200px] flex-1">
        {/* Quick-start lives in the writing area only (never between title chrome and editor). */}
        {!readOnly && isEmpty && (
          <div className={cn('mx-auto w-full px-6 pt-2', contentClassName ?? 'max-w-3xl')}>
            <DocQuickStart
              hasContent={false}
              readOnly={readOnly}
              onStartWriting={focusEditorStart}
              onBlankWiki={focusEditorStart}
              onMention={onQuickStartMention ?? insertAt}
            />
          </div>
        )}
        <div
          ref={editorRef}
          id={`doc-editor-${docId}`}
          role="textbox"
          aria-multiline="true"
          aria-label="Document body"
          aria-readonly={readOnly}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          spellCheck={!readOnly}
          onInput={
            readOnly
              ? undefined
              : () => {
                  emit()
                  syncMention()
                  selectBlock(document.getSelection()?.anchorNode ?? null)
                  reportCaret()
                }
          }
          onFocus={
            readOnly
              ? undefined
              : () => {
                  selectBlock(document.getSelection()?.anchorNode ?? null)
                  reportCaret()
                }
          }
          onBlur={
            readOnly
              ? undefined
              : () => {
                  // Drop block chrome when focus leaves the editor — but keep it when
                  // focus moves into portaled chrome (emoji/color/more menus).
                  window.setTimeout(() => {
                    const active = document.activeElement as HTMLElement | null
                    if (active && editorRef.current?.contains(active)) return
                    if (active?.closest?.('[data-doc-block-chrome]')) return
                    if (taskComposerOpenRef.current) return
                    setActiveBlock(null)
                  }, 0)
                }
          }
          onClick={onClick}
          onMouseUp={
            readOnly
              ? undefined
              : () => {
                  if (!createTaskDraft) updateSelectionBubble()
                  reportCaret()
                }
          }
          onKeyDown={
            readOnly
              ? undefined
              : (e) => {
                  // Alt+Meta+T / Alt+Ctrl+T → create task from selection
                  if (e.altKey && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
                    e.preventDefault()
                    const sel = window.getSelection()
                    const text = sel?.toString().trim() ?? ''
                    const rect = selectionRect()
                    if (text && rect) {
                      openCreateTask({
                        text,
                        top: rect.top,
                        bottom: rect.bottom,
                        centerX: rect.left + rect.width / 2,
                        width: rect.width,
                      })
                    }
                    return
                  }
                  onKeyDown(e)
                }
          }
          onKeyUp={
            readOnly
              ? undefined
              : () => {
                  syncMention()
                  reportCaret()
                }
          }
          data-placeholder={placeholder ?? 'Start writing…'}
          className={cn('docs-content mx-auto w-full px-6 py-6', contentClassName ?? 'max-w-3xl')}
        />
        {selectionBubble && !createTaskDraft && (
          <DocSelectionBubble
            position={selectionBubble}
            api={api}
            canComment={canComment}
            toolbarPosition={toolbarPosition}
            onToolbarPositionChange={setToolbarPosition}
            onComment={addInlineComment}
            onCreateSubpage={onCreateSubpage ? createSubpageFromSelection : undefined}
            onCreateTask={openCreateTask}
            onAfterCommand={updateSelectionBubble}
          />
        )}
        {createTaskDraft && (
          <DocCreateTaskBar
            documentId={docId}
            initialTitle={createTaskDraft.title}
            position={createTaskDraft.position}
            onClose={() => {
              savedTaskRange.current = null
              taskComposerOpenRef.current = false
              setCreateTaskDraft(null)
            }}
            onCreated={(task) => {
              const range = savedTaskRange.current
              savedTaskRange.current = null
              taskComposerOpenRef.current = false
              if (range && editorRef.current) {
                editorRef.current.focus()
                const sel = window.getSelection()
                sel?.removeAllRanges()
                sel?.addRange(range)
                insertHTML(
                  `<a class="doc-mention" data-mention="tasks" data-id="${escapeAttr(task.id)}" href="/app/tasks/${escapeAttr(task.id)}">#${escapeHtml(task.title)}</a>&nbsp;`,
                )
              }
              setCreateTaskDraft(null)
            }}
          />
        )}
        {mentionTrigger && (
          <DocEditorMentionPicker
            trigger={mentionTrigger}
            highlightIndex={mentionHighlight}
            onHighlight={setMentionHighlight}
            onPick={pickMention}
            onClose={() => setMentionTrigger(null)}
          />
        )}
        {activeBlock &&
          activeBlock.type !== 'banner' &&
          editorRef.current?.contains(activeBlock.el) && (
          <DocBlockChrome
            block={activeBlock.el}
            blockType={activeBlock.type}
            docId={docId}
            readOnly={readOnly}
            onChange={emit}
            onClose={() => setActiveBlock(null)}
          />
        )}
        {activeBlock?.type === 'banner' && editorRef.current?.contains(activeBlock.el) && (
          <DocBannerChrome
            block={activeBlock.el}
            docId={docId}
            readOnly={readOnly}
            onChange={emit}
            onClose={() => setActiveBlock(null)}
          />
        )}
        <InsertLinkDialog
          open={linkDialog.open}
          defaultUrl={linkDialog.defaultUrl}
          selectedText={linkDialog.selectedText}
          onClose={() => {
            savedLinkRange.current = null
            savedLinkSelection.current = ''
            setLinkDialog((prev) => ({ ...prev, open: false }))
          }}
          onApply={applyLink}
        />
      </div>
      {!readOnly && <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />}
    </div>
  )
})

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string) {
  return escapeHtml(s).replace(/"/g, '&quot;')
}
function normalizeUrl(url: string) {
  return /^(https?:|mailto:|\/)/i.test(url) ? url : `https://${url}`
}
