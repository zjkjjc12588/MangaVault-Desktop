import { useState } from "react";
import { ArchiveRestore, Database, FolderOpen, LoaderCircle, RotateCw } from "lucide-react";
import * as api from "../lib/api";
import { displayPath, formatNumber } from "../lib/format";
import { formatUserError, getUiLocale, t } from "../lib/i18n";
import type { DatabaseResetSchedule, StartupDataStatus } from "../lib/types";
import { Button } from "./ui/Button";

interface StartupDataDialogProps {
  status: StartupDataStatus;
  showOutcome: boolean;
  onContinue: () => Promise<void>;
  onDismissOutcome: () => void;
}

type DialogStep = "existing" | "confirm" | "scheduled";

export function StartupDataDialog({
  status,
  showOutcome,
  onContinue,
  onDismissOutcome,
}: StartupDataDialogProps) {
  const locale = getUiLocale();
  const [step, setStep] = useState<DialogStep>("existing");
  const [schedule, setSchedule] = useState<DatabaseResetSchedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outcome = showOutcome ? status.resetOutcome : null;

  const continueExisting = async () => {
    setBusy(true);
    setError(null);
    try {
      await onContinue();
    } catch (nextError) {
      setError(formatUserError(nextError, locale));
    } finally {
      setBusy(false);
    }
  };

  const scheduleReset = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.scheduleDatabaseReset();
      setSchedule(result);
      setStep("scheduled");
    } catch (nextError) {
      setError(formatUserError(nextError, locale));
    } finally {
      setBusy(false);
    }
  };

  const viewDataLocation = async () => {
    setError(null);
    try {
      await api.openPathInShell(status.appDataPath);
    } catch (nextError) {
      setError(formatUserError(nextError, locale));
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-5 backdrop-blur-sm">
      <section
        aria-labelledby="startup-data-title"
        aria-modal="true"
        className="w-full max-w-xl border border-border bg-panel p-6 shadow-2xl"
        role="dialog"
      >
        {outcome ? (
          <>
            <DialogHeading
              icon={outcome.success ? ArchiveRestore : Database}
              title={t(outcome.success ? "resetSucceededTitle" : "resetFailedTitle")}
              body={t(outcome.success ? "resetSucceededBody" : "resetFailedBody")}
            />
            <div className="mt-5 space-y-3 text-sm">
              {outcome.backupPath && (
                <PathDetail label={t("backupLocation")} path={outcome.backupPath} />
              )}
              {outcome.archivePath && (
                <PathDetail label={t("archiveLocation")} path={outcome.archivePath} />
              )}
              {!outcome.success && (
                <p className="border border-danger/40 bg-danger/10 p-3 text-danger">
                  {outcome.message}
                </p>
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <Button variant="primary" onClick={onDismissOutcome} type="button">
                {t("continue")}
              </Button>
            </div>
          </>
        ) : step === "existing" ? (
          <>
            <DialogHeading
              icon={Database}
              title={t("existingDataTitle")}
              body={t("existingDataBody")}
            />
            <p className="mt-3 text-sm text-muted">{t("existingDataSummary")}</p>
            <p className="mt-4 border border-border bg-background/60 p-3 text-sm text-muted">
              {locale === "zh-CN"
                ? `${formatNumber(status.summary.libraries, locale)} 个目录 · ${formatNumber(status.summary.books, locale)} 本漫画 · ${formatNumber(status.summary.bookmarks, locale)} 个书签`
                : `${formatNumber(status.summary.libraries, locale)} folders · ${formatNumber(status.summary.books, locale)} comics · ${formatNumber(status.summary.bookmarks, locale)} bookmarks`}
            </p>
            {error && <ErrorMessage message={error} />}
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Button
                className="sm:col-span-2"
                disabled={busy}
                onClick={() => void continueExisting()}
                type="button"
                variant="primary"
              >
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {t("continueExistingData")}
              </Button>
              <Button onClick={() => void viewDataLocation()} type="button">
                <FolderOpen className="h-4 w-4" />
                {t("viewDataLocation")}
              </Button>
              <Button onClick={() => setStep("confirm")} type="button">
                <ArchiveRestore className="h-4 w-4" />
                {t("backupAndStartOver")}
              </Button>
            </div>
          </>
        ) : step === "confirm" ? (
          <>
            <DialogHeading
              icon={ArchiveRestore}
              title={t("startOverConfirmTitle")}
              body={t("startOverConfirmBody")}
            />
            {error && <ErrorMessage message={error} />}
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button disabled={busy} onClick={() => setStep("existing")}>
                {t("back")}
              </Button>
              <Button
                disabled={busy}
                onClick={() => void scheduleReset()}
                type="button"
                variant="danger"
              >
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {t("confirmBackupAndRestart")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeading
              icon={ArchiveRestore}
              title={t("resetScheduledTitle")}
              body={t("resetScheduledBody")}
            />
            {schedule && <PathDetail label={t("backupLocation")} path={schedule.backupPath} />}
            {error && <ErrorMessage message={error} />}
            <div className="mt-6 flex justify-end">
              <Button onClick={() => void api.restartApplication()} type="button" variant="primary">
                <RotateCw className="h-4 w-4" />
                {t("restartNow")}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function DialogHeading({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Database;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center bg-accent/15 text-accent">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h1 className="text-lg font-semibold" id="startup-data-title">
          {title}
        </h1>
        <p className="mt-1 text-sm leading-6 text-muted">{body}</p>
      </div>
    </div>
  );
}

function PathDetail({ label, path }: { label: string; path: string }) {
  return (
    <div className="mt-4 border border-border bg-background/60 p-3 text-sm">
      <p className="font-medium">{label}</p>
      <p className="mt-1 break-all text-muted" title={displayPath(path)}>
        {displayPath(path)}
      </p>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p className="mt-4 border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{message}</p>
  );
}
