import { rgba } from 'polished'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { animated, useTransition } from 'react-spring'
import styled from 'styled-components'
import { TypedIpcRenderer } from '../../common/ipc'
import { RaisedButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { Portal } from '../material/portal'
import { defaultSpring } from '../material/springs'
import { zIndexDialogScrim } from '../material/zindex'
import { makeServerUrl } from '../network/server-url'
import { LoadingDotsArea } from '../progress/dots'
import { dialogScrim } from '../styles/colors'
import { Subtitle1 } from '../styles/typography'
import { addChangeHandler, removeChangeHandler, UpdateStateChangeHandler } from './updater-state'

const ipcRenderer = new TypedIpcRenderer()

const StyledPortal = styled(Portal)`
  z-index: 99999;
`

const Scrim = styled(animated.div)`
  position: fixed;
  left: 0;
  top: var(--sb-system-bar-height, 0);
  right: 0;
  bottom: 0;

  z-index: ${zIndexDialogScrim};

  -webkit-app-region: no-drag;
`

const INVISIBLE_SCRIM_COLOR = rgba(dialogScrim, 0)
const VISIBLE_SCRIM_COLOR = rgba(dialogScrim, 0.84)

export function UpdateOverlay() {
  const [hasUpdate, setHasUpdate] = useState(false)
  const [hasDownloadError, setHasDownloadError] = useState(false)
  const [readyToInstall, setReadyToInstall] = useState(false)
  const focusableRef = useRef<HTMLSpanElement>(null)

  const changeHandler = useCallback<UpdateStateChangeHandler>(state => {
    setHasUpdate(state.hasUpdate)
    setHasDownloadError(state.hasDownloadError)
    setReadyToInstall(state.readyToInstall)
  }, [])
  const onFocusTrap = useCallback(() => {
    // Focus was about to leave the dialog area, redirect it back to the dialog
    focusableRef.current?.focus()
  }, [])

  const scrimTransition = useTransition(hasUpdate, {
    from: {
      background: INVISIBLE_SCRIM_COLOR,
    },
    enter: { background: VISIBLE_SCRIM_COLOR },
    leave: { background: INVISIBLE_SCRIM_COLOR },
    config: {
      ...defaultSpring,
      clamp: true,
    },
  })

  useEffect(() => {
    const handler = changeHandler
    addChangeHandler(handler)

    return () => {
      removeChangeHandler(handler)
    }
  }, [changeHandler])

  useEffect(() => {
    if (hasUpdate) {
      focusableRef.current?.focus()
    }
  }, [hasUpdate])

  return hasUpdate ? (
    <StyledPortal open={true}>
      {scrimTransition((styles, open) => open && <Scrim style={styles} />)}

      <span tabIndex={0} onFocus={onFocusTrap} />
      <span ref={focusableRef} tabIndex={-1}>
        <UpdateDialog
          hasUpdate={hasUpdate}
          hasDownloadError={hasDownloadError}
          readyToInstall={readyToInstall}
        />
      </span>
      <span tabIndex={0} onFocus={onFocusTrap} />
    </StyledPortal>
  ) : null
}

const StyledDialog = styled(Dialog)`
  max-width: 480px;
  z-index: 99999;
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 32px;
`

export interface UpdateDialogProps {
  hasUpdate: boolean
  hasDownloadError: boolean
  readyToInstall: boolean
}

// NOTE(tec27): This is *not* available as a normal connected Dialog, it is only rendered by the
// `UpdateOverlay` component. We expose it for easier testing in dev pages.
export function UpdateDialog({ hasUpdate, hasDownloadError, readyToInstall }: UpdateDialogProps) {
  const title = !hasDownloadError ? 'Update available' : 'Error downloading update'

  let content = <span />
  if (hasDownloadError) {
    content = (
      <Subtitle1>
        There was an error downloading the update. Please restart and try again, or visit{' '}
        <a href={makeServerUrl('/')} target='_blank' rel='noopener noreferrer'>
          our website
        </a>{' '}
        to download the latest version.
      </Subtitle1>
    )
  } else if (readyToInstall) {
    content = (
      <Content>
        <Subtitle1>
          A new update has been downloaded and is ready to install. Please restart the application
          to continue.
        </Subtitle1>
        <RaisedButton
          onClick={() => ipcRenderer.send('updaterQuitAndInstall')}
          label='Restart now'
        />
      </Content>
    )
  } else if (hasUpdate) {
    content = (
      <Content>
        <Subtitle1>
          A new update is being downloaded. Please wait for the download to complete in order to
          continue.
        </Subtitle1>
        <LoadingDotsArea />
      </Content>
    )
  }

  return (
    <StyledDialog title={title} showCloseButton={false}>
      {content}
    </StyledDialog>
  )
}
