// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import classNames from 'classnames';
import { noop } from 'lodash';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { ContextMenuTrigger } from 'react-contextmenu';
import { createPortal } from 'react-dom';
import { Manager, Popper, Reference } from 'react-popper';
import type { PreventOverflowModifier } from '@popperjs/core/lib/modifiers/preventOverflow';
import { isDownloaded } from '../../types/Attachment';
import type { LocalizerType } from '../../types/I18N';
import { handleOutsideClick } from '../../util/handleOutsideClick';
import { offsetDistanceModifier } from '../../util/popperUtil';
import { StopPropagation } from '../StopPropagation';
import { WidthBreakpoint } from '../_util';
import { Message } from './Message';
import type { SmartReactionPicker } from '../../state/smart/ReactionPicker';
import type {
  Props as MessageProps,
  PropsActions as MessagePropsActions,
  PropsData as MessagePropsData,
  PropsHousekeeping,
} from './Message';
import type { PushPanelForConversationActionType } from '../../state/ducks/conversations';
import { doesMessageBodyOverflow } from './MessageBodyReadMore';
import type { Props as ReactionPickerProps } from './ReactionPicker';
import {
  useKeyboardShortcutsConditionally,
  useOpenContextMenu,
  useToggleReactionPicker,
} from '../../hooks/useKeyboardShortcuts';
import { PanelType } from '../../types/Panels';
import type {
  DeleteMessagesPropsType,
  ForwardMessagesPayload,
} from '../../state/ducks/globalModals';
import { useScrollerLock } from '../../hooks/useScrollLock';
import {
  type ContextMenuTriggerType,
  MessageContextMenu,
  useHandleMessageContextMenu,
} from './MessageContextMenu';
import { ForwardMessagesModalType } from '../ForwardMessagesModal';

export type PropsData = {
  canDownload: boolean;
  canCopy: boolean;
  canEditMessage: boolean;
  canForward: boolean;
  canRetry: boolean;
  canRetryDeleteForEveryone: boolean;
  canReact: boolean;
  canReply: boolean;
  hasAlternativeInteractions?: boolean;
  selectedReaction?: string;
  isTargeted?: boolean;
} & Omit<MessagePropsData, 'renderingContext' | 'menu'>;

export type PropsActions = {
  pushPanelForConversation: PushPanelForConversationActionType;
  toggleDeleteMessagesModal: (props: DeleteMessagesPropsType) => void;
  toggleForwardMessagesModal: (payload: ForwardMessagesPayload) => void;
  reactToMessage: (
    id: string,
    { emoji, remove }: { emoji: string; remove: boolean }
  ) => void;
  retryMessageSend: (id: string) => void;
  copyMessageText: (id: string) => void;
  retryDeleteForEveryone: (id: string) => void;
  setMessageToEdit: (conversationId: string, messageId: string) => unknown;
  setQuoteByMessageId: (conversationId: string, messageId: string) => void;
  toggleSelectMessage: (
    conversationId: string,
    messageId: string,
    shift: boolean,
    selected: boolean
  ) => void;
} & Omit<MessagePropsActions, 'onToggleSelect' | 'onReplyToMessage'>;

export type Props = PropsData &
  PropsActions &
  Omit<PropsHousekeeping, 'isAttachmentPending'> &
  Pick<ReactionPickerProps, 'renderEmojiPicker'> & {
    renderReactionPicker: (
      props: React.ComponentProps<typeof SmartReactionPicker>
    ) => JSX.Element;
  };

/**
 * Message with menu/context-menu (as necessary for rendering in the timeline)
 */
export function TimelineMessage(props: Props): JSX.Element {
  const {
    attachments,
    author,
    canDownload,
    canCopy,
    canEditMessage,
    canForward,
    canReact,
    canReply,
    canRetry,
    canRetryDeleteForEveryone,
    containerElementRef,
    containerWidthBreakpoint,
    conversationId,
    direction,
    hasAlternativeInteractions,
    i18n,
    id,
    isTargeted,
    kickOffAttachmentDownload,
    copyMessageText,
    pushPanelForConversation,
    reactToMessage,
    renderEmojiPicker,
    renderReactionPicker,
    retryDeleteForEveryone,
    retryMessageSend,
    saveAttachment,
    saveAttachments,
    showAttachmentDownloadStillInProgressToast,
    selectedReaction,
    setQuoteByMessageId,
    setMessageToEdit,
    text,
    timestamp,
    toggleDeleteMessagesModal,
    toggleForwardMessagesModal,
    toggleSelectMessage,
  } = props;

  const [reactionPickerRoot, setReactionPickerRoot] = useState<
    HTMLDivElement | undefined
  >(undefined);
  const [isHoveringReactionButton, setIsHoveringReactionButton] = useState(false);
  const [isHoveringPicker, setIsHoveringPicker] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [isHoveringMessageCorner, setIsHoveringMessageCorner] = useState(false);
  const [showMiniEmojiPicker, setShowMiniEmojiPicker] = useState(false);
  const [hoverTimeout, setHoverTimeout] = useState<NodeJS.Timeout | null>(null);
  const [isHoveringTimestamp, setIsHoveringTimestamp] = useState(false);
  const [showTimestampEmojiPicker, setShowTimestampEmojiPicker] = useState(false);
  const [timestampHoverTimeout, setTimestampHoverTimeout] = useState<NodeJS.Timeout | null>(null);
  const [isMouseOverMessage, setIsMouseOverMessage] = useState(false);
  const menuTriggerRef = useRef<ContextMenuTriggerType | null>(null);

  const isWindowWidthNotNarrow =
    containerWidthBreakpoint !== WidthBreakpoint.Narrow;

  const popperPreventOverflowModifier =
    useCallback((): Partial<PreventOverflowModifier> => {
      return {
        name: 'preventOverflow',
        options: {
          altAxis: true,
          boundary: containerElementRef.current || undefined,
          padding: {
            bottom: 16,
            left: 8,
            right: 8,
            top: 16,
          },
        },
      };
    }, [containerElementRef]);

  // This id is what connects our triple-dot click with our associated pop-up menu.
  //   It needs to be unique.
  const triggerId = String(id || `${author.id}-${timestamp}`);

  const toggleReactionPicker = useCallback(
    (onlyRemove = false): void => {
      if (reactionPickerRoot) {
        document.body.removeChild(reactionPickerRoot);
        setReactionPickerRoot(undefined);
        setIsHoveringReactionButton(false);
        setIsHoveringPicker(false);
        return;
      }

      if (!onlyRemove) {
        const root = document.createElement('div');
        document.body.appendChild(root);

        setReactionPickerRoot(root);
      }
    },
    [reactionPickerRoot]
  );

  useScrollerLock({
    reason: 'TimelineMessage reactionPicker',
    lockScrollWhen: reactionPickerRoot != null,
    onUserInterrupt() {
      toggleReactionPicker(true);
    },
  });

  // Close picker when not hovering over either button or picker
  useEffect(() => {
    if (reactionPickerRoot && !isHoveringReactionButton && !isHoveringPicker && !contextMenuOpen) {
      // Small delay to prevent flicker when moving between elements
      const timeoutId = setTimeout(() => {
        if (!isHoveringReactionButton && !isHoveringPicker && !contextMenuOpen) {
          toggleReactionPicker(true);
        }
      }, 50);

      return () => clearTimeout(timeoutId);
    }
  }, [reactionPickerRoot, isHoveringReactionButton, isHoveringPicker, contextMenuOpen, toggleReactionPicker]);

  useEffect(() => {
    let cleanUpHandler: (() => void) | undefined;
    if (reactionPickerRoot) {
      cleanUpHandler = handleOutsideClick(
        target => {
          if (
            target instanceof Element &&
            target.closest('[data-fun-overlay]') != null
          ) {
            return true;
          }
          toggleReactionPicker(true);
          return true;
        },
        {
          containerElements: [reactionPickerRoot],
          name: 'Message.reactionPicker',
        }
      );
    }
    return () => {
      cleanUpHandler?.();
    };
  });

  const openGenericAttachment = useCallback(
    (event?: React.MouseEvent): void => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      if (!attachments || attachments.length === 0) {
        return;
      }

      let attachmentsInProgress = 0;
      // check if any attachment needs to be downloaded from servers
      for (const attachment of attachments) {
        if (!isDownloaded(attachment)) {
          kickOffAttachmentDownload({ messageId: id });

          attachmentsInProgress += 1;
        }
      }

      if (attachmentsInProgress !== 0) {
        showAttachmentDownloadStillInProgressToast(attachmentsInProgress);
      }

      if (attachments.length !== 1) {
        saveAttachments(attachments, timestamp);
      } else {
        saveAttachment(attachments[0], timestamp);
      }
    },
    [
      kickOffAttachmentDownload,
      saveAttachments,
      saveAttachment,
      showAttachmentDownloadStillInProgressToast,
      attachments,
      id,
      timestamp,
    ]
  );

  const baseHandleContextMenu = useHandleMessageContextMenu(menuTriggerRef);
  
  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
    console.log('handleContextMenu called', { event, canReact, reactionPickerRoot });
    
    // Always call the base context menu handler first
    baseHandleContextMenu(event);
    
    // Only show reaction picker for alternative style interactions
    if (hasAlternativeInteractions) {
      setContextMenuOpen(true);
      if (canReact && !reactionPickerRoot) {
        console.log('Opening reaction picker from context menu');
        // Use mouse coordinates for positioning
        const mouseX = event.clientX;
        const mouseY = event.clientY;
        
        const root = document.createElement('div');
        root.style.position = 'fixed'; // Use fixed positioning for mouse coordinates
        root.style.top = `${mouseY - 140}px`; // Position higher above the mouse cursor to avoid overlap
        root.style.left = `${mouseX + 10}px`; // Position slightly to the right of mouse
        root.style.zIndex = '1001';
        document.body.appendChild(root);
        setReactionPickerRoot(root);
      }
    }
  }, [baseHandleContextMenu, canReact, reactionPickerRoot, hasAlternativeInteractions]);

  const shouldShowAdditional =
    doesMessageBodyOverflow(text || '') || !isWindowWidthNotNarrow;

  const handleDownload = canDownload ? openGenericAttachment : undefined;

  const handleReplyToMessage = useCallback(() => {
    if (!canReply) {
      return;
    }
    setQuoteByMessageId(conversationId, id);
  }, [canReply, conversationId, id, setQuoteByMessageId]);

  // Handle wheel event for swipe left gesture
  const handleWheel = useCallback((event: React.WheelEvent) => {
    if (!hasAlternativeInteractions || !isMouseOverMessage) {
      return;
    }
    
    // Detect horizontal scroll (swipe left)
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && event.deltaX > 30) {
      // Swipe left detected - trigger reply
      if (canReply) {
        handleReplyToMessage();
      }
    }
  }, [hasAlternativeInteractions, isMouseOverMessage, canReply, handleReplyToMessage]);

  const handleReact = useCallback(() => {
    if (canReact) {
      toggleReactionPicker();
    }
  }, [canReact, toggleReactionPicker]);

  const toggleReactionPickerKeyboard = useToggleReactionPicker(
    handleReact || noop
  );

  const openContextMenuKeyboard = useOpenContextMenu(handleContextMenu);

  useKeyboardShortcutsConditionally(
    Boolean(isTargeted),
    openContextMenuKeyboard,
    toggleReactionPickerKeyboard
  );

  const renderMenu = useCallback(() => {
    return (
      <Manager>
        <MessageMenu
          i18n={i18n}
          triggerId={triggerId}
          isWindowWidthNotNarrow={isWindowWidthNotNarrow}
          direction={direction}
          menuTriggerRef={menuTriggerRef}
          showMenu={handleContextMenu}
          onDownload={handleDownload}
          onReplyToMessage={canReply ? handleReplyToMessage : undefined}
          onReact={canReact ? handleReact : undefined}
          hasAlternativeInteractions={hasAlternativeInteractions}
          reactionPickerRoot={reactionPickerRoot}
          setIsHoveringReactionButton={setIsHoveringReactionButton}
        />
        {reactionPickerRoot &&
          createPortal(
            <div
              onMouseEnter={() => setIsHoveringPicker(true)}
              onMouseLeave={() => setIsHoveringPicker(false)}
            >
              {renderReactionPicker({
                selected: selectedReaction,
                style: {
                  zIndex: contextMenuOpen ? 1001 : 1000, // Ensure it appears above context menu
                },
                onClose: () => {
                  toggleReactionPicker(true);
                  setContextMenuOpen(false);
                },
                onPick: emoji => {
                  toggleReactionPicker(true);
                  setContextMenuOpen(false);
                  reactToMessage(id, {
                    emoji,
                    remove: emoji === selectedReaction,
                  });
                },
                renderEmojiPicker,
              })}
            </div>,
            reactionPickerRoot
          )}
      </Manager>
    );
  }, [
    i18n,
    triggerId,
    isWindowWidthNotNarrow,
    direction,
    menuTriggerRef,
    canReply,
    canReact,
    handleContextMenu,
    handleDownload,
    handleReplyToMessage,
    handleReact,
    hasAlternativeInteractions,
    reactionPickerRoot,
    setIsHoveringReactionButton,
    setIsHoveringPicker,
    renderReactionPicker,
    selectedReaction,
    reactToMessage,
    renderEmojiPicker,
    toggleReactionPicker,
    id,
    contextMenuOpen,
  ]);

  // Handle hover timeout for mini emoji picker in alternative style mode
  useEffect(() => {
    if (hasAlternativeInteractions && isHoveringMessageCorner) {
      const timeoutId = setTimeout(() => {
        setShowMiniEmojiPicker(true);
      }, 100);
      setHoverTimeout(timeoutId);
      
      return () => {
        clearTimeout(timeoutId);
      };
    } else {
      if (hoverTimeout) {
        clearTimeout(hoverTimeout);
        setHoverTimeout(null);
      }
      setShowMiniEmojiPicker(false);
    }
  }, [hasAlternativeInteractions, isHoveringMessageCorner]);

  // Handle hover timeout for timestamp emoji picker in alternative style mode
  useEffect(() => {
    if (hasAlternativeInteractions && isHoveringTimestamp) {
      const timeoutId = setTimeout(() => {
        setShowTimestampEmojiPicker(true);
      }, 100);
      setTimestampHoverTimeout(timeoutId);
      
      return () => {
        clearTimeout(timeoutId);
      };
    } else {
      if (timestampHoverTimeout) {
        clearTimeout(timestampHoverTimeout);
        setTimestampHoverTimeout(null);
      }
      setShowTimestampEmojiPicker(false);
    }
  }, [hasAlternativeInteractions, isHoveringTimestamp]);

  // Cleanup hover timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeout) {
        clearTimeout(hoverTimeout);
      }
      if (timestampHoverTimeout) {
        clearTimeout(timestampHoverTimeout);
      }
    };
  }, [hoverTimeout, timestampHoverTimeout]);

  // Reset context menu state when reaction picker is closed
  useEffect(() => {
    if (!reactionPickerRoot && contextMenuOpen) {
      setContextMenuOpen(false);
    }
  }, [reactionPickerRoot, contextMenuOpen]);

  // Debug menuTriggerRef
  useEffect(() => {
    console.log('menuTriggerRef updated:', menuTriggerRef.current);
  }, [menuTriggerRef.current]);

  return (
    <>
      <div 
        style={{ position: 'relative' }}
        onWheel={handleWheel}
        onMouseEnter={() => setIsMouseOverMessage(true)}
        onMouseLeave={() => setIsMouseOverMessage(false)}
      >
        <Message
          {...props}
          renderingContext="conversation/TimelineItem"
          onContextMenu={handleContextMenu}
          renderMenu={renderMenu}
          onToggleSelect={(selected, shift) => {
            toggleSelectMessage(conversationId, id, shift, selected);
          }}
          onReplyToMessage={handleReplyToMessage}
        />
        
        {/* Hover detection overlay for alternative style interactions */}
        {hasAlternativeInteractions && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: '60px',
              height: '40px',
              zIndex: 1,
            }}
            onMouseEnter={() => setIsHoveringMessageCorner(true)}
            onMouseLeave={() => setIsHoveringMessageCorner(false)}
          />
        )}
        
        {/* Timestamp hover detection for alternative style interactions */}
        {hasAlternativeInteractions && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: direction === 'outgoing' ? 0 : 'auto',
              right: direction === 'incoming' ? 0 : 'auto',
              width: '80px',
              height: '20px',
              zIndex: 1,
            }}
            onMouseEnter={() => setIsHoveringTimestamp(true)}
            onMouseLeave={() => setIsHoveringTimestamp(false)}
          />
        )}
        
        {/* Mini emoji picker for alternative style interactions (corner hover) */}
        {hasAlternativeInteractions && showMiniEmojiPicker && (
          <div
            style={{
              position: 'absolute',
              bottom: '10px',
              right: '10px',
              background: 'rgba(0, 0, 0, 0.8)',
              borderRadius: '20px',
              padding: '8px',
              fontSize: '24px',
              zIndex: 1000,
              cursor: 'pointer',
            }}
            onMouseEnter={() => {
              // Show full reaction picker on hover
              if (canReact && !reactionPickerRoot) {
                toggleReactionPicker();
              }
            }}
            onClick={() => {
              // Quick react with the first emoji (❤️)
              reactToMessage(id, {
                emoji: '❤️',
                remove: selectedReaction === '❤️',
              });
            }}
          >
            ❤️
          </div>
        )}
        
        {/* Mini emoji picker for timestamp hover */}
        {hasAlternativeInteractions && showTimestampEmojiPicker && (
          <div
            style={{
              position: 'absolute',
              bottom: '10px',
              left: direction === 'outgoing' ? '10px' : 'auto',
              right: direction === 'incoming' ? '10px' : 'auto',
              background: 'rgba(0, 0, 0, 0.8)',
              borderRadius: '20px',
              padding: '8px',
              fontSize: '24px',
              zIndex: 1000,
              cursor: 'pointer',
            }}
            onMouseEnter={() => {
              // Show full reaction picker on hover
              if (canReact && !reactionPickerRoot) {
                toggleReactionPicker();
              }
            }}
            onClick={() => {
              // Quick react with the first emoji (❤️)
              reactToMessage(id, {
                emoji: '❤️',
                remove: selectedReaction === '❤️',
              });
            }}
          >
            ❤️
          </div>
        )}
      </div>

      <MessageContextMenu
        i18n={i18n}
        triggerId={triggerId}
        shouldShowAdditional={shouldShowAdditional}
        interactionMode={props.interactionMode}
        onDownload={handleDownload}
        onEdit={
          canEditMessage
            ? () => setMessageToEdit(conversationId, id)
            : undefined
        }
        onReplyToMessage={handleReplyToMessage}
        onReact={handleReact}
        onRetryMessageSend={canRetry ? () => retryMessageSend(id) : undefined}
        onRetryDeleteForEveryone={
          canRetryDeleteForEveryone
            ? () => retryDeleteForEveryone(id)
            : undefined
        }
        onCopy={canCopy ? () => copyMessageText(id) : undefined}
        onSelect={() => toggleSelectMessage(conversationId, id, false, true)}
        onForward={
          canForward
            ? () =>
                toggleForwardMessagesModal({
                  type: ForwardMessagesModalType.Forward,
                  messageIds: [id],
                })
            : undefined
        }
        onDeleteMessage={() => {
          toggleDeleteMessagesModal({
            conversationId,
            messageIds: [id],
          });
        }}
        onMoreInfo={() =>
          pushPanelForConversation({
            type: PanelType.MessageDetails,
            args: { messageId: id },
          })
        }
      />
    </>
  );
}

type MessageMenuProps = {
  i18n: LocalizerType;
  triggerId: string;
  isWindowWidthNotNarrow: boolean;
  menuTriggerRef: Ref<ContextMenuTriggerType>;
  showMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  onDownload: (() => void) | undefined;
  onReplyToMessage: (() => void) | undefined;
  onReact: (() => void) | undefined;
  hasAlternativeInteractions?: boolean;
  reactionPickerRoot: HTMLDivElement | undefined;
  setIsHoveringReactionButton: React.Dispatch<React.SetStateAction<boolean>>;
} & Pick<MessageProps, 'i18n' | 'direction'>;

function MessageMenu({
  i18n,
  triggerId,
  direction,
  isWindowWidthNotNarrow,
  menuTriggerRef,
  showMenu,
  onDownload,
  onReplyToMessage,
  onReact,
  hasAlternativeInteractions,
  reactionPickerRoot,
  setIsHoveringReactionButton,
}: MessageMenuProps) {
  // This a menu meant for mouse use only
  /* eslint-disable jsx-a11y/interactive-supports-focus */
  /* eslint-disable jsx-a11y/click-events-have-key-events */
  const menuButton = (
    <Reference>
      {({ ref: popperRef }) => {
        // Only attach the popper reference to the collapsed menu button if the reaction
        //   button is not visible (it is hidden when the timeline is narrow)
        const maybePopperRef = !isWindowWidthNotNarrow ? popperRef : undefined;

        return (
          <StopPropagation className="module-message__buttons__menu--container">
            <ContextMenuTrigger
              id={triggerId}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ref={menuTriggerRef as any}
            >
              <div
                ref={maybePopperRef}
                role="button"
                onClick={showMenu}
                aria-label={i18n('icu:messageContextMenuButton')}
                className={classNames(
                  'module-message__buttons__menu',
                  `module-message__buttons__download--${direction}`
                )}
                style={{
                  // Hide the button visually when alternative style interactions are enabled
                  display: hasAlternativeInteractions ? 'none' : undefined,
                }}
                onDoubleClick={ev => {
                  // Prevent double click from triggering the replyToMessage action
                  ev.stopPropagation();
                }}
              />
            </ContextMenuTrigger>
          </StopPropagation>
        );
      }}
    </Reference>
  );
  /* eslint-enable jsx-a11y/interactive-supports-focus */
  /* eslint-enable jsx-a11y/click-events-have-key-events */

  return (
    <div
      className={classNames(
        'module-message__buttons',
        `module-message__buttons--${direction}`
      )}
      style={{
        // Hide the entire button container when alternative style interactions are enabled
        display: hasAlternativeInteractions ? 'none' : undefined,
      }}
    >
      {!hasAlternativeInteractions && isWindowWidthNotNarrow && (
        <>
          {onReact && (
            <Reference>
              {({ ref: popperRef }) => {
                // Only attach the popper reference to the reaction button if it is
                //   visible (it is hidden when the timeline is narrow)
                const maybePopperRef = isWindowWidthNotNarrow
                  ? popperRef
                  : undefined;

                return (
                  // This a menu meant for mouse use only
                  // eslint-disable-next-line max-len
                  // eslint-disable-next-line jsx-a11y/interactive-supports-focus, jsx-a11y/click-events-have-key-events
                  <div
                    ref={maybePopperRef}
                    onClick={(event: React.MouseEvent) => {
                      event.stopPropagation();
                      event.preventDefault();

                      onReact();
                    }}
                    onMouseEnter={() => {
                      setIsHoveringReactionButton(true);
                      // Show emoji picker on hover for alternative-style UX
                      if (!reactionPickerRoot) {
                        onReact();
                      }
                    }}
                    onMouseLeave={() => {
                      setIsHoveringReactionButton(false);
                    }}
                    role="button"
                    className="module-message__buttons__react"
                    aria-label={i18n('icu:reactToMessage')}
                    onDoubleClick={ev => {
                      // Prevent double click from triggering the replyToMessage action
                      ev.stopPropagation();
                    }}
                  />
                );
              }}
            </Reference>
          )}

          {onDownload && (
            // This a menu meant for mouse use only
            // eslint-disable-next-line max-len
            // eslint-disable-next-line jsx-a11y/interactive-supports-focus, jsx-a11y/click-events-have-key-events
            <div
              onClick={onDownload}
              role="button"
              aria-label={i18n('icu:downloadAttachment')}
              className={classNames(
                'module-message__buttons__download',
                `module-message__buttons__download--${direction}`
              )}
              onDoubleClick={ev => {
                // Prevent double click from triggering the replyToMessage action
                ev.stopPropagation();
              }}
            />
          )}

          {onReplyToMessage && (
            // This a menu meant for mouse use only
            // eslint-disable-next-line max-len
            // eslint-disable-next-line jsx-a11y/interactive-supports-focus, jsx-a11y/click-events-have-key-events
            <div
              onClick={(event: React.MouseEvent) => {
                event.stopPropagation();
                event.preventDefault();

                onReplyToMessage();
              }}
              // This a menu meant for mouse use only
              role="button"
              aria-label={i18n('icu:replyToMessage')}
              className={classNames(
                'module-message__buttons__reply',
                `module-message__buttons__download--${direction}`
              )}
              onDoubleClick={ev => {
                // Prevent double click from triggering the replyToMessage action
                ev.stopPropagation();
              }}
            />
          )}
        </>
      )}
      {menuButton}
    </div>
  );
}
