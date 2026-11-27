#include <QSysInfo>
#include <QProcess>
#include <QMap>
#include <QtNetwork/qnetworkinterface.h>
#include <QGuiApplication>
#include <QCursor>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QJsonObject>
#include <QJsonDocument>
#include <QNetworkRequest>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QSslConfiguration>
#include <QSslSocket>
#include <QSslCertificate>
#include <QSslError>
#include <QDebug>
#include <QRegularExpression>
#include <functional>

#include <QtWebEngineCore/qtwebenginecoreglobal.h>

#include "input/InputComponent.h"
#include "SystemComponent.h"
#include "Version.h"
#include "settings/SettingsComponent.h"
#include "settings/SettingsSection.h"
#include "Paths.h"
#include "core/ProfileManager.h"
#include "Names.h"
#include "utils/Utils.h"
#include "utils/Log.h"


#define KONVERGO_PRODUCTID_DEFAULT  3
#define KONVERGO_PRODUCTID_OPENELEC 4

// Platform types map
QMap<SystemComponent::PlatformType, QString> g_platformTypeNames = { \
  { SystemComponent::platformTypeOsx, "macosx" }, \
  { SystemComponent::platformTypeWindows, "windows" },
  { SystemComponent::platformTypeLinux, "linux" },
  { SystemComponent::platformTypeOpenELEC, "openelec" },
  { SystemComponent::platformTypeFreeBSD, "freebsd" },
  { SystemComponent::platformTypeUnknown, "unknown" },
};

// platform Archictecture map
QMap<SystemComponent::PlatformArch, QString> g_platformArchNames = {
  { SystemComponent::platformArchX86_32, "i386" },
  { SystemComponent::platformArchX86_64, "x86_64" },
  { SystemComponent::platformArchRpi2, "rpi2" },
  { SystemComponent::platformArchUnknown, "unknown" }
};


///////////////////////////////////////////////////////////////////////////////////////////////////
SystemComponent::SystemComponent(QObject* parent) : ComponentBase(parent), m_platformType(platformTypeUnknown), m_platformArch(platformArchUnknown), m_doLogMessages(false), m_scale(1), m_connectivityCheckReply(nullptr), m_resolveUrlReply(nullptr)
{
  m_connectivityRetryTimer = new QTimer(this);
  m_connectivityRetryTimer->setSingleShot(true);
  connect(m_connectivityRetryTimer, &QTimer::timeout, this, &SystemComponent::runConnectivityAttempt);
  m_connectivityDeadline.setSingleShot(true);
  m_connectivityDeadline.setTimerType(Qt::PreciseTimer);
  connect(&m_connectivityDeadline, &QTimer::timeout, this, [this]() {
    if (m_pendingConnectivityUrl.isEmpty())
      return;
    const QString url = m_pendingConnectivityUrl;
    const QString requestId = m_pendingConnectivityRequestId;
    const QString failure = m_connectivityFailure;
    cancelServerConnectivity();
    emit serverConnectivityResult(url, false, failure, requestId);
  });

  m_networkManager = new QNetworkAccessManager(this);

// define OS Type
#if defined(Q_OS_MAC)
  m_platformType = platformTypeOsx;
#elif defined(Q_OS_WIN)
  m_platformType = platformTypeWindows;
#elif defined(KONVERGO_OPENELEC)
  m_platformType = platformTypeOpenELEC;
#elif defined(Q_OS_LINUX)
  m_platformType = platformTypeLinux;
#elif defined(Q_OS_FREEBSD)
  m_platformType = platformTypeFreeBSD;
#endif

// define target type
#ifdef TARGET_RPI
  m_platformArch = platformArchRpi2;
#elif defined(Q_PROCESSOR_X86_32)
  m_platformArch = platformArchX86_32;
#elif defined(Q_PROCESSOR_X86_64)
  m_platformArch = platformArchX86_64;
#endif

  if (auto* s = SettingsComponent::Get().getSection(SETTINGS_SECTION_AUDIO))
  {
    connect(s, &SettingsSection::valuesUpdated, [=]()
    {
      emit capabilitiesChanged(getCapabilitiesString());
    });
  }
}

/////////////////////////////////////////////////////////////////////////////////////////
bool SystemComponent::componentInitialize()
{
  QDir().mkpath(ProfileManager::activeProfile().dataDir("scripts"));
  QDir().mkpath(ProfileManager::activeProfile().dataDir("sounds"));

  return true;
}

/////////////////////////////////////////////////////////////////////////////////////////
void SystemComponent::crashApp()
{
  *static_cast<volatile int*>(nullptr) = 0;
}

/////////////////////////////////////////////////////////////////////////////////////////
void SystemComponent::componentPostInitialize()
{
  InputComponent::Get().registerHostCommand("crash!", this, "crashApp");
  InputComponent::Get().registerHostCommand("script", this, "runUserScript");
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString SystemComponent::getPlatformTypeString() const
{
  return g_platformTypeNames[m_platformType];
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString SystemComponent::getPlatformArchString() const
{
  return g_platformArchNames[m_platformArch];
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QVariantMap SystemComponent::systemInformation() const
{
  QVariantMap info;
  QString build;
  QString dist;
  QString arch;
  int productid = KONVERGO_PRODUCTID_DEFAULT;

#ifdef Q_OS_WIN
  arch = (sizeof(void *) == 8) ? "x86_64" : "i386";
#else
  arch = QSysInfo::currentCpuArchitecture();
#endif

  build = getPlatformTypeString();
  dist = getPlatformTypeString();

#if defined(KONVERGO_OPENELEC)
  productid = KONVERGO_PRODUCTID_OPENELEC;
  dist = "openelec";

  if (m_platformArch == platformArchRpi2)
  {
    build = "rpi2";
  }
  else
  {
    build = "generic";
  }
#endif

  
  info["build"] = build + "-" + arch;
  info["dist"] = dist;
  info["version"] = Version::GetVersionString();
  info["productid"] = productid;
  
 qDebug() << QString(
                "System Information : build(%1)-arch(%2).dist(%3).version(%4).productid(%5)")
                .arg(build)
                .arg(arch)
                .arg(dist)
                .arg(Version::GetVersionString())
                .arg(productid);
 return info;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void SystemComponent::exit()
{
  qApp->quit();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void SystemComponent::restart()
{
  qApp->quit();
  QProcess::startDetached(qApp->arguments()[0], qApp->arguments());
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void SystemComponent::jsLog(int level, QString text)
{
  switch (level) {
    case 0: // Info
      qInfo() << "JS:" << qPrintable(text);
      break;
    case 1: // Warning
      qWarning() << "JS:" << qPrintable(text);
      break;
    case 2: // Error
      qCritical() << "JS:" << qPrintable(text);
      break;
    default:
      qDebug() << "JS: [uncaught level=" << level << "]" << qPrintable(text);
      break;
  }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString SystemComponent::urlForLog(const QUrl& url)
{
  return url.toString(QUrl::RemoveUserInfo | QUrl::RemoveQuery | QUrl::RemoveFragment | QUrl::FullyEncoded);
}

QString SystemComponent::extractBaseUrl(const QString& url)
{
  QUrl parsedUrl(url);
  if (!parsedUrl.isValid() || parsedUrl.host().isEmpty() ||
      (parsedUrl.scheme() != "http" && parsedUrl.scheme() != "https"))
    return QString();

  // Match a complete /web path segment, preserving encoded slashes in proxy paths.
  const QString path = parsedUrl.path(QUrl::FullyEncoded);
  static const QRegularExpression webSegment("/web(?=/|$)", QRegularExpression::CaseInsensitiveOption);
  auto matches = webSegment.globalMatch(path);
  QString basePath;
  while (matches.hasNext())
    basePath = path.left(matches.next().capturedStart());

  parsedUrl.setPath(basePath, QUrl::StrictMode);
  parsedUrl.setUserInfo(QString());
  parsedUrl.setQuery(QString());
  parsedUrl.setFragment(QString());
  if ((parsedUrl.scheme() == "https" && parsedUrl.port() == 443) ||
      (parsedUrl.scheme() == "http" && parsedUrl.port() == 80))
    parsedUrl.setPort(-1);

  // Let QUrl serialize the authority, including IPv6 brackets.
  return parsedUrl.toString(QUrl::FullyEncoded);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QSslConfiguration SystemComponent::getSSLConfiguration()
{
  QSslConfiguration sslConfig = QSslConfiguration::defaultConfiguration();
  if (SettingsComponent::Get().ignoreSSLErrors()) {
    sslConfig.setPeerVerifyMode(QSslSocket::VerifyNone);
  } else if (SettingsComponent::Get().autodetectCertBundle()) {
    QString certPath = SettingsComponent::Get().detectCertBundlePath();
    if (!certPath.isEmpty()) {
      QList<QSslCertificate> certs = QSslCertificate::fromPath(certPath);
      if (!certs.isEmpty()) {
        sslConfig.setCaCertificates(certs);
      }
    }
  }
  return sslConfig;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void SystemComponent::setReplyTimeout(QNetworkReply* reply, int ms)
{
  QTimer::singleShot(ms, reply, [reply]() {
    if (!reply->isFinished()) {
      reply->abort();
    }
  });
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void SystemComponent::resolveUrl(const QString& url, std::function<void(const QString&)> callback)
{
  // Abort any pending resolve
  if (m_resolveUrlReply) {
    QNetworkReply* reply = m_resolveUrlReply;
    m_resolveUrlReply = nullptr;
    reply->abort();
    reply->deleteLater();
  }

  QNetworkRequest request(url);
  request.setHeader(QNetworkRequest::UserAgentHeader, getUserAgent());
  request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
  request.setSslConfiguration(getSSLConfiguration());

  m_resolveUrlReply = m_networkManager->head(request);

  QNetworkReply* reply = m_resolveUrlReply;
  setReplyTimeout(reply, NETWORK_REQUEST_TIMEOUT_MS);

  if (SettingsComponent::Get().ignoreSSLErrors()) {
    connect(reply, QOverload<const QList<QSslError>&>::of(&QNetworkReply::sslErrors),
            reply, QOverload<>::of(&QNetworkReply::ignoreSslErrors));
  }
  connect(reply, &QNetworkReply::finished, this, [this, reply, callback]() {
    reply->deleteLater();
    // Cancelled/replaced replies cannot complete a later request, even for the same URL.
    if (m_resolveUrlReply != reply)
      return;
    m_resolveUrlReply = nullptr;

    if (reply->error() != QNetworkReply::NoError) {
      qWarning() << "resolveUrl: network error" << reply->error();
      const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
      // Some servers reject HEAD (e.g. HTTP 405), but their API can still answer GET.
      // Network failures and our timeout need a retry instead of leaving JS waiting.
      if (reply->error() == QNetworkReply::OperationCanceledError || status < 400 || status >= 600) {
        if (reply->error() != QNetworkReply::OperationCanceledError)
          m_connectivityFailure = reply->error() == QNetworkReply::SslHandshakeFailedError ? "tlsError" : "networkError";
        callback(QString());
        return;
      }
    }

    callback(reply->url().userInfo().isEmpty() ? reply->url().toString(QUrl::FullyEncoded) : QString());
  });
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void SystemComponent::checkServerConnectivity(QString url, QString requestId)
{
  cancelServerConnectivity();
  if (extractBaseUrl(url).isEmpty() || !QUrl(url).userInfo().isEmpty()) {
    emit serverConnectivityResult(url, false, QStringLiteral("invalidAddress"), requestId);
    return;
  }

  // Store for retry
  m_pendingConnectivityUrl = url;
  m_pendingConnectivityRequestId = requestId;
  m_connectivityFailure = QStringLiteral("timedOut");
  m_connectivityDeadline.start(CONNECTIVITY_BUDGET_MS);
  runConnectivityAttempt();
}

void SystemComponent::runConnectivityAttempt()
{
  if (m_pendingConnectivityUrl.isEmpty())
    return;
  const QString url = m_pendingConnectivityUrl;
  const QString requestId = m_pendingConnectivityRequestId;

  resolveUrl(url, [this, url, requestId](const QString& fullResolvedUrl) {
    QString baseUrl = extractBaseUrl(fullResolvedUrl);
    if (baseUrl.isEmpty()) {
      m_connectivityRetryTimer->start(CONNECTIVITY_RETRY_INTERVAL_MS);
      return;
    }

    QString checkUrl = baseUrl + "/System/Info/Public";

    QNetworkRequest request(checkUrl);
    request.setHeader(QNetworkRequest::UserAgentHeader, getUserAgent());
    request.setRawHeader("Cache-Control", "no-cache");
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    request.setSslConfiguration(getSSLConfiguration());

    m_connectivityCheckReply = m_networkManager->get(request);

    QNetworkReply* reply = m_connectivityCheckReply;
    setReplyTimeout(reply, NETWORK_REQUEST_TIMEOUT_MS);

    if (SettingsComponent::Get().ignoreSSLErrors()) {
      connect(reply, QOverload<const QList<QSslError>&>::of(&QNetworkReply::sslErrors),
              reply, QOverload<>::of(&QNetworkReply::ignoreSslErrors));
    }

    connect(reply, &QNetworkReply::finished, this, [this, reply, url, fullResolvedUrl, requestId]() {
      reply->deleteLater();
      if (m_connectivityCheckReply != reply)
        return;
      m_connectivityCheckReply = nullptr;

      bool success = false;
      if (reply->error() == QNetworkReply::NoError) {
        QByteArray data = reply->readAll();
        QJsonDocument doc = QJsonDocument::fromJson(data);
        if (doc.isObject() && doc.object().contains("Id") && !doc.object()["Id"].toString().isEmpty()) {
          success = true;
        } else {
          m_connectivityFailure = QStringLiteral("invalidResponse");
          qWarning() << "checkServerConnectivity: invalid response";
        }
      } else {
        if (reply->error() != QNetworkReply::OperationCanceledError)
          m_connectivityFailure = reply->error() == QNetworkReply::SslHandshakeFailedError ? "tlsError" : "networkError";
        qWarning() << "checkServerConnectivity: network error" << reply->error();
      }

      if (success) {
        cancelServerConnectivity();
        emit serverConnectivityResult(url, success, fullResolvedUrl, requestId);
      } else {
        m_connectivityRetryTimer->start(CONNECTIVITY_RETRY_INTERVAL_MS);
      }
    });
  });
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void SystemComponent::cancelServerConnectivity()
{
  m_connectivityDeadline.stop();
  m_connectivityFailure.clear();
  if (m_connectivityRetryTimer->isActive()) {
    m_connectivityRetryTimer->stop();
  }

  // Save pointers before abort() since it synchronously triggers finished handlers
  // which may set member variables to nullptr
  if (m_resolveUrlReply) {
    QNetworkReply* reply = m_resolveUrlReply;
    m_resolveUrlReply = nullptr;
    reply->abort();
    reply->deleteLater();
  }

  if (m_connectivityCheckReply) {
    QNetworkReply* reply = m_connectivityCheckReply;
    m_connectivityCheckReply = nullptr;
    reply->abort();
    reply->deleteLater();
  }

  m_pendingConnectivityUrl.clear();
  m_pendingConnectivityRequestId.clear();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString SystemComponent::getUserAgent()
{
  QString kernel = QSysInfo::kernelType();
  kernel[0] = kernel[0].toUpper();
  QString chromeVersion = QString(qWebEngineChromiumVersion()).split('.').first() + ".0.0.0";
  QString userAgent = QString("JellyfinDesktop/%1 (%2; %3) Chrome/%4")
    .arg(Version::GetVersionString())
    .arg(kernel)
    .arg(getPlatformArchString())
    .arg(chromeVersion);
  return userAgent;
}

/////////////////////////////////////////////////////////////////////////////////////////
QString SystemComponent::debugInformation()
{
  QString debugInfo;
  QTextStream stream(&debugInfo);

  stream << "Jellyfin\n";
  stream << "  Version: " << Version::GetVersionString() << " built: " << Version::GetBuildDate() << "\n";
  stream << "  Web Client Version: " << Version::GetWebVersion() << "\n";
  stream << "  Web Client URL: " << urlForLog(SettingsComponent::Get().value(SETTINGS_SECTION_PATH, "startupurl").toUrl()) << "\n";
  stream << "  Platform: " << getPlatformTypeString() << "-" << getPlatformArchString() << "\n";
  stream << "  User-Agent: " << getUserAgent() << "\n";
  stream << "  Qt version: " << qVersion() << QString("(%1)").arg(Version::GetQtDepsVersion()) << "\n";
  stream << "  Depends version: " << Version::GetDependenciesVersion() << "\n";
  stream << "\n";

  stream << "Files\n";
  stream << "  Log file: " << ProfileManager::activeProfile().logDir() + "/" + Names::DataName() + ".log" << "\n";
  stream << "  Config file: " << ProfileManager::activeProfile().dataDir(Names::DataName() + ".conf") << "\n";
  stream << "\n";

  stream << "Network Addresses\n";
  for(const QString& addr : networkAddresses())
  {
    stream << "  " << addr << "\n";
  }
  stream << "\n";

  stream.flush();
  return debugInfo;
}

/////////////////////////////////////////////////////////////////////////////////////////
QStringList SystemComponent::networkAddresses() const
{
  QStringList list;
  for(const QHostAddress& address : QNetworkInterface::allAddresses())
  {
    if (! address.isLoopback() && (address.protocol() == QAbstractSocket::IPv4Protocol ||
                                   address.protocol() == QAbstractSocket::IPv6Protocol))
    {
      auto s = address.toString();
      if (!s.startsWith("fe80::"))
        list << s;
    }
  }

  return list;
}

/////////////////////////////////////////////////////////////////////////////////////////
void SystemComponent::openExternalUrl(const QString& url)
{
  QDesktopServices::openUrl(QUrl(url));
}

/////////////////////////////////////////////////////////////////////////////////////////
void SystemComponent::runUserScript(QString script)
{
  // We take the path the user supplied and run it through fileInfo and
  // look for the fileName() part, this is to avoid people sharing keymaps
  // that tries to execute things like ../../ etc. Note that this function
  // is still not safe, people can do nasty things with it, so users needs
  // to be careful with their keymaps.
  //
  QFileInfo fi(script);
  QString scriptPath = ProfileManager::activeProfile().dataDir("scripts/" + fi.fileName());

  QFile scriptFile(scriptPath);
  if (scriptFile.exists())
  {
    if (!QFileInfo(scriptFile).isExecutable())
    {
      qWarning() << "Script:" << script << "is not executable";
      return;
    }

    qInfo() << "Running script:" << scriptPath;

    if (QProcess::startDetached(scriptPath, QStringList()))
      qDebug() << "Script started successfully";
    else
      qWarning() << "Error running script:" << scriptPath;
  }
  else
  {
    qWarning() << "Could not find script:" << scriptPath;
  }
}

/////////////////////////////////////////////////////////////////////////////////////////
void SystemComponent::hello(const QString& version)
{
  qDebug() << QString("Web-client (%1) fully inited.").arg(version);
  m_webClientVersion = version;
}

/////////////////////////////////////////////////////////////////////////////////////////
QString SystemComponent::getNativeShellScript()
{
  static QString cachedScript;
  if (!cachedScript.isEmpty()) {
    return cachedScript;
  }

  auto path = SettingsComponent::Get().getExtensionPath();
  qDebug() << QString("Using path for extension: %1").arg(path);

  QJsonObject clientData = QJsonObject::fromVariantMap(SettingsComponent::Get().webClientSettings());
  clientData.insert("deviceName", QJsonValue::fromVariant(SettingsComponent::Get().getClientName()));
  clientData.insert("version", QJsonValue::fromVariant(Version::GetVersionString()));
  clientData.insert("userAgent", QJsonValue::fromVariant(getUserAgent()));
  clientData.insert("scriptPath", QJsonValue::fromVariant("file:///" + path));
  QString defaultMode = SettingsComponent::Get().value(SETTINGS_SECTION_MAIN, "layout").toString();

  QFile flatpakOsFile {"/run/host/os-release"};
  if (flatpakOsFile.exists()) {
    qDebug() << "Found flatpak os-release file";
    if (flatpakOsFile.open(QIODevice::ReadOnly)) {
      QString flatpakOsFileString = QTextStream(&flatpakOsFile).readAll();
      if (flatpakOsFileString.contains("NAME=\"SteamOS\"")) {
        qDebug() << "Detected SteamOS";
        defaultMode = "tv";
      }
    }
  }
  clientData.insert("mode", QJsonValue::fromVariant(defaultMode));

  QString jmpInfoDeclaration = "const jmpInfo = JSON.parse(window.atob(\"" +
                                QJsonDocument(clientData).toJson(QJsonDocument::Compact).toBase64() +
                                "\"));\nwindow.jmpInfo = jmpInfo;\n";

  auto loadScript = [](const QString& scriptPath) -> QString {
    QFile file(scriptPath);
    if (!file.open(QIODevice::ReadOnly)) {
      qCritical() << "Failed to load" << scriptPath << "from qrc";
      return "";
    }
    return QTextStream(&file).readAll();
  };

  QStringList scriptPaths = {
    ":/qtwebchannel/qwebchannel.js",
    ":/web-client/extension/mpvVideoPlayer.js",
    ":/web-client/extension/mpvAudioPlayer.js",
    ":/web-client/extension/inputPlugin.js",
    ":/web-client/extension/updatePlugin.js",
    ":/web-client/extension/connectivityHelper.js",
    ":/web-client/extension/nativeshell.js"
  };

  cachedScript = jmpInfoDeclaration;
  for (const QString& scriptPath : scriptPaths) {
    cachedScript += loadScript(scriptPath) + "\n";
  }

  return cachedScript;
}

/////////////////////////////////////////////////////////////////////////////////////////
void SystemComponent::fetchPageForCSPWorkaround(QString url)
{
  qDebug() << "fetchPageForCSPWorkaround:" << urlForLog(QUrl(url));

  QNetworkRequest request(url);
  request.setHeader(QNetworkRequest::UserAgentHeader, getUserAgent());
  request.setRawHeader("Cache-Control", "no-cache");

  // Configure SSL settings
  QSslConfiguration sslConfig = request.sslConfiguration();
  if (SettingsComponent::Get().ignoreSSLErrors()) {
    qDebug() << "fetchPageForCSPWorkaround: ignoring SSL errors";
    sslConfig.setPeerVerifyMode(QSslSocket::VerifyNone);
  }
  request.setSslConfiguration(sslConfig);

  QNetworkReply* reply = m_networkManager->get(request);

  // Handle SSL errors if ignoreSSLErrors is enabled
  if (SettingsComponent::Get().ignoreSSLErrors()) {
    connect(reply, QOverload<const QList<QSslError>&>::of(&QNetworkReply::sslErrors),
            this, [reply](const QList<QSslError>& errors) {
      qDebug() << "fetchPageForCSPWorkaround: ignoring SSL errors:" << errors;
      reply->ignoreSslErrors();
    });
  }

  connect(reply, &QNetworkReply::finished, this, [this, reply, url]() {
    if (reply->error() == QNetworkReply::NoError) {
      QByteArray rawData = reply->readAll();
      QString html = QString::fromUtf8(rawData);
      QString finalUrl = reply->url().toString();
      bool hadCSP = false;

      // Check for CSP headers
      QList<QByteArray> headerList = reply->rawHeaderList();
      for (const QByteArray& header : headerList) {
        QString headerName = QString::fromUtf8(header);
        if (headerName.toLower() == "content-security-policy" ||
            headerName.toLower() == "content-security-policy-report-only") {
          hadCSP = true;
          qInfo() << "CSP header detected:" << headerName;
        }
      }

      if (hadCSP) {
        qInfo() << "CSP workaround: applying for" << urlForLog(QUrl(url));
      } else {
        qDebug() << "No CSP detected for" << urlForLog(QUrl(url));
      }

      emit pageContentReady(html, finalUrl, hadCSP);
    } else {
      qCritical() << "fetchPageForCSPWorkaround: fetch failed:" << reply->errorString();
    }
    reply->deleteLater();
  });
}

/////////////////////////////////////////////////////////////////////////////////////////
void SystemComponent::checkForUpdates()
{
#ifndef DISABLE_UPDATE_CHECK
  if (SettingsComponent::Get().value(SETTINGS_SECTION_MAIN, "checkForUpdates").toBool()) {
#if !defined(Q_OS_WIN) && !defined(Q_OS_MAC)
    QNetworkAccessManager *manager = new QNetworkAccessManager(this);
    QString checkUrl = "https://github.com/jellyfin/jellyfin-desktop/releases/latest";
    QUrl qCheckUrl = QUrl(checkUrl);
    qDebug() << QString("Checking URL for updates: %1").arg(checkUrl);
    QNetworkRequest req(qCheckUrl);
    req.setHeader(QNetworkRequest::UserAgentHeader, getUserAgent());

    connect(manager, &QNetworkAccessManager::finished, this, &SystemComponent::updateInfoHandler);
    manager->get(req);
#else
    emit updateInfoEmitted("SSL_UNAVAILABLE");
#endif
  }
#endif
}

/////////////////////////////////////////////////////////////////////////////////////////
void SystemComponent::updateInfoHandler(QNetworkReply* reply)
{
  if (reply->error() == QNetworkReply::NoError) {
    int statusCode = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    if(statusCode == 302) {
      QUrl redirectUrl = reply->attribute(QNetworkRequest::RedirectionTargetAttribute).toUrl();
      emit updateInfoEmitted(redirectUrl.toString());
    }
  }
}

/////////////////////////////////////////////////////////////////////////////////////////
#define BASESTR "protocols=shoutcast,http-video;videoDecoders=h264{profile:high&resolution:2160&level:52};audioDecoders=mp3,aac,dts{bitrate:800000&channels:%1},ac3{bitrate:800000&channels:%2}"

/////////////////////////////////////////////////////////////////////////////////////////
QString SystemComponent::getCapabilitiesString()
{
  auto capstring = QString(BASESTR);
  auto channels = SettingsComponent::Get().value(SETTINGS_SECTION_AUDIO, "channels").toString();
  auto dtsenabled = SettingsComponent::Get().value(SETTINGS_SECTION_AUDIO, "passthrough.dts").toBool();
  auto ac3enabled = SettingsComponent::Get().value(SETTINGS_SECTION_AUDIO, "passthrough.ac3").toBool();

  // Assume that auto means that we want to select multi-channel tracks by default.
  // So really only disable it when 2.0 is selected.
  //
  int ac3channels = 2;
  int dtschannels = 2;

  if (channels != "2.0")
    dtschannels = ac3channels = 8;
  else if (dtsenabled)
    dtschannels = 8;
  else if (ac3enabled)
    ac3channels = 8;

  return capstring.arg(dtschannels).arg(ac3channels);
}
