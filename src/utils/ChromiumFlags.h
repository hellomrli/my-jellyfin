#ifndef CHROMIUMFLAGS_H
#define CHROMIUMFLAGS_H

#include <QString>

QString chromiumFlags(const QString& existing, bool disableGpu, bool disablePinch,
                      bool ignoreCertificateErrors);

#endif
