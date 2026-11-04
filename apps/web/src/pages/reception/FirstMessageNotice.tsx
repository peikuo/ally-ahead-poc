import { Modal } from "../../components/Modal";
import { useLocale } from "../../locales/context";

export function FirstMessageNotice({
  onConfirm,
  onModify,
}: {
  onConfirm: () => void;
  onModify: () => void;
}) {
  const { t } = useLocale();
  return (
    <Modal
      className="reception-privacy-dialog"
      title={t("发送前，检查一下内容", "A quick check before sending")}
      onClose={onModify}
    >
      <div className="reception-privacy-icon" aria-hidden="true">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z" />
          <path d="m8 12 3 3 5-6" />
        </svg>
      </div>
      <p className="reception-privacy-copy">
        {t(
          "请确认这段话不包含公司机密信息。你可以用概括或脱敏后的例子来说明需求。",
          "Please leave out confidential company information. Use a general description or an anonymized example to explain your needs.",
        )}
      </p>
      <p className="reception-privacy-note">
        {t(
          "这次交流只提醒一次。",
          "You’ll only see this reminder once in this conversation.",
        )}
      </p>
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onModify}>
          {t("返回修改", "Edit message")}
        </button>
        <button type="button" className="primary" onClick={onConfirm}>
          {t("确认并发送", "Confirm and send")}
        </button>
      </div>
    </Modal>
  );
}
