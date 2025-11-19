import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, JSX, MouseEvent } from 'react'
import { createSecret, deleteSecret, fetchSecretDetail, fetchSecrets, type SecretDetail, type SecretSummary } from '../api/secrets'
import styles from './Secrets.module.css'

const SECRETS_STALE_TIME_MS = 60_000
const SECRET_DETAIL_STALE_TIME_MS = 60_000
const FEEDBACK_TIMEOUT_MS = 4_000

type SecretFeedback = {
  type: 'success' | 'error'
  message: string
}

type SecretEntry = {
  id: string
  key: string
  value: string
}

let secretEntryIdCounter = 0
const createEmptySecretEntry = (): SecretEntry => ({
  id: `secret-entry-${secretEntryIdCounter++}`,
  key: '',
  value: '',
})

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message : fallback

const Secrets = (): JSX.Element => {
  const queryClient = useQueryClient()
  const secretsQuery = useQuery<SecretSummary[], Error>({
    queryKey: ['secrets', 'list'],
    queryFn: fetchSecrets,
    staleTime: SECRETS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })

  const [selectedSecretName, setSelectedSecretName] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [secretNameInput, setSecretNameInput] = useState('')
  const [secretEntries, setSecretEntries] = useState<SecretEntry[]>([createEmptySecretEntry()])
  const [formError, setFormError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<SecretFeedback | null>(null)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const modalNameInputRef = useRef<HTMLInputElement | null>(null)
  const deleteModalPrimaryButtonRef = useRef<HTMLButtonElement | null>(null)

  const secretDetailQuery = useQuery<SecretDetail, Error>({
    queryKey: ['secrets', 'detail', selectedSecretName],
    queryFn: () => {
      if (!selectedSecretName) {
        throw new Error('Secret not selected')
      }
      return fetchSecretDetail(selectedSecretName)
    },
    enabled: Boolean(selectedSecretName),
    staleTime: SECRET_DETAIL_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })

  const createSecretMutation = useMutation<void, Error, { name: string; data: Record<string, string> }>({
    mutationFn: createSecret,
  })
  const deleteSecretMutation = useMutation<void, Error, string>({
    mutationFn: deleteSecret,
  })

  const availableSecrets = secretsQuery.data ?? []
  const isSecretsLoading = secretsQuery.isPending
  const secretsErrorMessage = secretsQuery.isError
    ? getErrorMessage(secretsQuery.error, 'Failed to load secrets.')
    : null

  useEffect(() => {
    const secretList = secretsQuery.data ?? []
    if (secretList.length === 0) {
      setSelectedSecretName(null)
      return
    }
    setSelectedSecretName((current) => {
      if (current && secretList.some((secret) => secret.name === current)) {
        return current
      }
      return secretList[0]?.name ?? null
    })
  }, [secretsQuery.data])

  useEffect(() => {
    if (!feedback) return undefined
    const timeoutId = window.setTimeout(() => setFeedback(null), FEEDBACK_TIMEOUT_MS)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [feedback])

  useEffect(() => {
    if (!isCreateModalOpen) return undefined
    const rafId = window.requestAnimationFrame(() => {
      modalNameInputRef.current?.focus()
    })
    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [isCreateModalOpen])

  useEffect(() => {
    if (!isDeleteModalOpen) return undefined
    const rafId = window.requestAnimationFrame(() => {
      deleteModalPrimaryButtonRef.current?.focus()
    })
    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [isDeleteModalOpen])

  const resetCreateForm = () => {
    setSecretNameInput('')
    setSecretEntries([createEmptySecretEntry()])
    setFormError(null)
  }

  const handleSecretSelect = (name: string) => {
    setSelectedSecretName(name)
  }

  const handleOpenCreateModal = () => {
    resetCreateForm()
    setIsCreateModalOpen(true)
  }

  const handleCloseCreateModal = () => {
    if (createSecretMutation.isPending) return
    setIsCreateModalOpen(false)
  }

  const handleOverlayClick = () => {
    if (createSecretMutation.isPending) return
    setIsCreateModalOpen(false)
  }

  const handleModalClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }

  const handleDeleteModalOverlayClick = () => {
    if (deleteSecretMutation.isPending) return
    setIsDeleteModalOpen(false)
    setDeleteTarget(null)
  }

  const handleDeleteModalClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }

  const handleSecretNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSecretNameInput(event.target.value)
    if (formError) setFormError(null)
  }

  const handleEntryChange = (entryId: string, field: 'key' | 'value', value: string) => {
    setSecretEntries((prev) => prev.map((entry) => (entry.id === entryId ? { ...entry, [field]: value } : entry)))
    if (formError) setFormError(null)
  }

  const handleAddEntry = () => {
    setSecretEntries((prev) => [...prev, createEmptySecretEntry()])
  }

  const handleRemoveEntry = (entryId: string) => {
    setSecretEntries((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((entry) => entry.id !== entryId)
    })
  }

  const handleCreateSecret = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (createSecretMutation.isPending) return

    const trimmedName = secretNameInput.trim()
    if (!trimmedName) {
      setFormError('Secret name is required.')
      return
    }

    const preparedEntries = secretEntries
      .map(({ key, value }) => ({ key: key.trim(), value: value.trim() }))
      .filter(({ key, value }) => key && value)

    if (preparedEntries.length === 0) {
      setFormError('At least one key/value pair is required.')
      return
    }

    const data = preparedEntries.reduce<Record<string, string>>((acc, { key, value }) => {
      acc[key] = value
      return acc
    }, {})

    try {
      await createSecretMutation.mutateAsync({ name: trimmedName, data })
      await queryClient.invalidateQueries({ queryKey: ['secrets', 'list'] })
      await queryClient.invalidateQueries({ queryKey: ['secrets', 'detail', trimmedName] })
      setFeedback({ type: 'success', message: `Secret “${trimmedName}” created successfully.` })
      setSelectedSecretName(trimmedName)
      setIsCreateModalOpen(false)
      resetCreateForm()
    } catch (error) {
      setFormError(getErrorMessage(error, 'Failed to create secret. Please try again.'))
    }
  }

  const handleDeleteSecretRequest = () => {
    if (!selectedSecretName) return
    setDeleteTarget(selectedSecretName)
    setIsDeleteModalOpen(true)
  }

  const handleConfirmDeleteSecret = async () => {
    if (!deleteTarget || deleteSecretMutation.isPending) return

    try {
      await deleteSecretMutation.mutateAsync(deleteTarget)
      await queryClient.invalidateQueries({ queryKey: ['secrets', 'list'] })
      queryClient.removeQueries({ queryKey: ['secrets', 'detail', deleteTarget], exact: true })
      setSelectedSecretName(null)
      setFeedback({ type: 'success', message: `Secret “${deleteTarget}” deleted.` })
      setIsDeleteModalOpen(false)
      setDeleteTarget(null)
    } catch (error) {
      setFeedback({ type: 'error', message: getErrorMessage(error, 'Failed to delete secret. Please try again.') })
    }
  }

  let detailContent: JSX.Element
  if (!selectedSecretName) {
    detailContent = <p className={styles.detailPlaceholder}>Select a secret to view its keys.</p>
  } else if (secretDetailQuery.isPending) {
    detailContent = <p className={styles.detailPlaceholder}>Loading secret details…</p>
  } else if (secretDetailQuery.isError) {
    detailContent = (
      <p className={`${styles.detailPlaceholder} ${styles.detailError}`}>
        {getErrorMessage(secretDetailQuery.error, 'Failed to load secret details.')}
      </p>
    )
  } else if (!secretDetailQuery.data) {
    detailContent = <p className={styles.detailPlaceholder}>Secret details unavailable.</p>
  } else if (secretDetailQuery.data.keys.length === 0) {
    detailContent = <p className={styles.detailPlaceholder}>No keys configured for this secret.</p>
  } else {
    detailContent = (
      <ul className={styles.keyList}>
        {secretDetailQuery.data.keys.map((keyName) => (
          <li key={keyName} className={styles.keyPill}>
            {keyName}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className={styles.secrets}>
      <header className={styles.header}>
        <div>
          <h1>Secrets</h1>
          <p>Manage key/value pairs that can be attached to jobs.</p>
        </div>
        <button type="button" className={styles.primaryAction} onClick={handleOpenCreateModal}>
          Create Secret
        </button>
      </header>

      {feedback ? (
        <div
          className={`${styles.feedback} ${
            feedback.type === 'success' ? styles.feedbackSuccess : styles.feedbackError
          }`}
          role={feedback.type === 'success' ? 'status' : 'alert'}
          aria-live={feedback.type === 'success' ? 'polite' : 'assertive'}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            className={styles.feedbackDismiss}
            onClick={() => setFeedback(null)}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      ) : null}

      <div className={styles.grid}>
        <section className={styles.listCard} aria-label="Secrets list">
          <div className={styles.cardHeader}>
            <h2>Secrets</h2>
            {isSecretsLoading ? <span className={styles.cardMeta}>Loading…</span> : null}
          </div>
          {secretsErrorMessage ? (
            <p className={`${styles.cardPlaceholder} ${styles.cardPlaceholderError}`}>{secretsErrorMessage}</p>
          ) : availableSecrets.length === 0 && !isSecretsLoading ? (
            <p className={styles.cardPlaceholder}>No secrets found. Create one to get started.</p>
          ) : (
            <ul className={styles.secretList}>
              {availableSecrets.map(({ name }) => {
                const isActive = name === selectedSecretName
                return (
                  <li key={name}>
                    <button
                      type="button"
                      className={`${styles.secretItem} ${isActive ? styles.secretItemActive : ''}`.trim()}
                      onClick={() => handleSecretSelect(name)}
                    >
                      <span className={styles.secretName}>{name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className={styles.detailCard} aria-live="polite">
          <div className={styles.cardHeader}>
            <div className={styles.cardTitleGroup}>
              <h2>{selectedSecretName ? selectedSecretName : 'Secret details'}</h2>
              {selectedSecretName ? <span className={styles.cardMeta}>Keys</span> : null}
            </div>
            {selectedSecretName ? (
              <button
                type="button"
                className={styles.dangerAction}
                onClick={handleDeleteSecretRequest}
                disabled={deleteSecretMutation.isPending}
              >
                Delete Secret
              </button>
            ) : null}
          </div>
          {detailContent}
        </section>
      </div>

      {isCreateModalOpen ? (
        <div className={styles.modalOverlay} role="presentation" onClick={handleOverlayClick}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="create-secret-title" onClick={handleModalClick}>
            <header className={styles.modalHeader}>
              <div>
                <h2 id="create-secret-title">Create Secret</h2>
                <p className={styles.modalDescription}>Provide a unique name and at least one key/value pair.</p>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={handleCloseCreateModal}
                aria-label="Close create secret modal"
                disabled={createSecretMutation.isPending}
              >
                ×
              </button>
            </header>

            {formError ? (
              <div className={`${styles.formFeedback} ${styles.formFeedbackError}`} role="alert">
                {formError}
              </div>
            ) : null}

            <form className={styles.modalForm} onSubmit={handleCreateSecret} noValidate>
              <label className={styles.formField}>
                <span className={styles.fieldLabel}>Secret name</span>
                <input
                  ref={modalNameInputRef}
                  type="text"
                  value={secretNameInput}
                  onChange={handleSecretNameChange}
                  className={styles.fieldControl}
                  placeholder="e.g. prod-api"
                  disabled={createSecretMutation.isPending}
                  required
                />
                <span className={styles.fieldHint}>Used when referencing this secret on job submissions.</span>
              </label>

              <div className={styles.entriesHeader}>
                <span className={styles.fieldLabel}>Key/value pairs</span>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={handleAddEntry}
                  disabled={createSecretMutation.isPending}
                >
                  + Add key
                </button>
              </div>
              <div className={styles.entriesList}>
                {secretEntries.map((entry, index) => (
                  <div key={entry.id} className={styles.entryRow}>
                    <div className={styles.entryField}>
                      <label className={styles.entryLabel} htmlFor={`${entry.id}-key`}>
                        Key
                      </label>
                      <input
                        id={`${entry.id}-key`}
                        type="text"
                        value={entry.key}
                        onChange={(event) => handleEntryChange(entry.id, 'key', event.target.value)}
                        className={styles.fieldControl}
                        placeholder={`key-${index + 1}`}
                        disabled={createSecretMutation.isPending}
                        required
                      />
                    </div>
                    <div className={styles.entryField}>
                      <label className={styles.entryLabel} htmlFor={`${entry.id}-value`}>
                        Value
                      </label>
                      <input
                        id={`${entry.id}-value`}
                        type="text"
                        value={entry.value}
                        onChange={(event) => handleEntryChange(entry.id, 'value', event.target.value)}
                        className={styles.fieldControl}
                        placeholder="Value"
                        disabled={createSecretMutation.isPending}
                        required
                      />
                    </div>
                    <button
                      type="button"
                      className={styles.removeEntryButton}
                      onClick={() => handleRemoveEntry(entry.id)}
                      disabled={createSecretMutation.isPending || secretEntries.length === 1}
                      aria-label="Remove key"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <footer className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.secondaryAction}
                  onClick={handleCloseCreateModal}
                  disabled={createSecretMutation.isPending}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.submitButton} disabled={createSecretMutation.isPending}>
                  {createSecretMutation.isPending ? 'Creating…' : 'Create Secret'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}

      {isDeleteModalOpen && deleteTarget ? (
        <div className={styles.modalOverlay} role="presentation" onClick={handleDeleteModalOverlayClick}>
          <div
            className={`${styles.modal} ${styles.confirmModal}`.trim()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-secret-title"
            onClick={handleDeleteModalClick}
          >
            <header className={styles.modalHeader}>
              <div>
                <h2 id="delete-secret-title">Delete Secret</h2>
                <p className={styles.modalDescription}>This action cannot be undone.</p>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={handleDeleteModalOverlayClick}
                aria-label="Close delete secret modal"
                disabled={deleteSecretMutation.isPending}
              >
                ×
              </button>
            </header>
            <p className={styles.confirmMessage}>
              Are you sure you want to delete <strong>{deleteTarget}</strong>? Jobs referencing this secret will no longer
              receive its values.
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.secondaryAction}
                onClick={handleDeleteModalOverlayClick}
                disabled={deleteSecretMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                ref={deleteModalPrimaryButtonRef}
                className={styles.dangerAction}
                onClick={handleConfirmDeleteSecret}
                disabled={deleteSecretMutation.isPending}
              >
                {deleteSecretMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default Secrets
