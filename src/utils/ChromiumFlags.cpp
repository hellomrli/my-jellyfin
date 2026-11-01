#include "ChromiumFlags.h"

#include <QProcess>
#include <QStringList>
#include <algorithm>

QString chromiumFlags(const QString& existing, bool disableGpu, bool disablePinch,
                      bool ignoreCertificateErrors)
{
  const QStringList supplied = QProcess::splitCommand(existing);
  const auto hasSwitch = [&supplied](const QString& name) {
    return std::any_of(supplied.cbegin(), supplied.cend(), [&name](const QString& arg) {
      return arg == name || arg.startsWith(name + "=");
    });
  };

  QStringList added;
  if (!hasSwitch("--lang"))
    added << "--lang=zh-CN";

  if (disableGpu && !hasSwitch("--disable-gpu"))
    added << "--disable-gpu";
  else if (!disableGpu && !hasSwitch("--disable-gpu") && !hasSwitch("--disable-gpu-rasterization")
           && !hasSwitch("--enable-gpu-rasterization"))
    added << "--enable-gpu-rasterization";

  QStringList disabledFeatures;
  const QString featureSwitch = "--disable-features=";
  for (const QString& arg : supplied)
  {
    if (arg.startsWith(featureSwitch))
      disabledFeatures = arg.mid(featureSwitch.size()).split(',', Qt::SkipEmptyParts);
  }
  disabledFeatures << "MediaSessionService";
#ifdef Q_OS_LINUX
  // Native MPRIS owns the media keys instead of Chromium.
  disabledFeatures << "HardwareMediaKeyHandling";
#endif
  disabledFeatures.removeDuplicates();
  added << featureSwitch + disabledFeatures.join(',');

  if (disablePinch && !hasSwitch("--disable-pinch"))
    added << "--disable-pinch";
  if (ignoreCertificateErrors && !hasSwitch("--ignore-certificate-errors"))
    added << "--ignore-certificate-errors";

  // Preserve quoting in user-supplied flags such as --js-flags="... ...".
  return existing.isEmpty() ? added.join(' ') : existing + ' ' + added.join(' ');
}
