#include <QtTest/QtTest>
#include <QNetworkProxy>
#include <QTcpServer>
#include <QTcpSocket>
#include "../src/system/SystemComponent.h"
#include "settings/SettingsComponent.h"
#include "settings/SettingsSection.h"

// Exercise Qt's real reply/abort behavior without a Jellyfin server or the internet.
class ConnectivityServer : public QTcpServer
{
public:
  struct Request
  {
    QByteArray method;
    QByteArray path;
  };

  QList<Request> requests;
  bool answerHead = true;
  bool answerInfo = true;
  int headStatus = 200;
  QByteArray infoBody = R"({"Id":"test-server"})";

  ConnectivityServer()
  {
    connect(this, &QTcpServer::newConnection, this, [this]() {
      while (hasPendingConnections())
      {
        auto* socket = nextPendingConnection();
        connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
        connect(socket, &QTcpSocket::readyRead, this, [this, socket, data = QByteArray()]() mutable {
          data += socket->readAll();
          if (!data.contains("\r\n\r\n"))
            return;
          const auto parts = data.left(data.indexOf("\r\n")).split(' ');
          socket->disconnect(this);
          if (parts.size() < 2)
            return;
          requests.append({parts[0], parts[1]});
          const bool head = parts[0] == "HEAD";
          if ((head && !answerHead) || (!head && !answerInfo))
            return;
          const auto body = head ? QByteArray() : infoBody;
          socket->write("HTTP/1.1 " + QByteArray::number(head ? headStatus : 200) + " Test\r\n"
                        "Content-Type: application/json\r\nConnection: close\r\nContent-Length: "
                        + QByteArray::number(body.size()) + "\r\n\r\n" + body);
          socket->disconnectFromHost();
        });
      }
    });
  }

  QString url(const QString& path = "/web/") const
  {
    const auto host = serverAddress().protocol() == QAbstractSocket::IPv6Protocol
      ? "[" + serverAddress().toString() + "]" : serverAddress().toString();
    return "http://" + host + ":" + QString::number(serverPort()) + path;
  }
};

class TestSystemComponent : public QObject
{
  Q_OBJECT

private slots:
  void initTestCase();
  void testExtractBaseUrl_data();
  void testExtractBaseUrl();
  void replacingPendingRequest_data();
  void replacingPendingRequest();
  void replacingStandaloneResolve();
  void timeoutRetries_data();
  void timeoutRetries();
  void totalDeadline_data();
  void totalDeadline();
  void cancellationStopsRetries_data();
  void cancellationStopsRetries();
  void connectivityUsesBaseUrl_data();
  void connectivityUsesBaseUrl();
  void unsupportedHeadStillChecksServer();
  void invalidPublicInfoRetries_data();
  void invalidPublicInfoRetries();
  void invalidAddressFailsImmediately_data();
  void invalidAddressFailsImmediately();
};

void TestSystemComponent::initTestCase()
{
  auto* main = new SettingsSection(SETTINGS_SECTION_MAIN, PLATFORM_ANY, -1, &SettingsComponent::Get());
  main->registerSetting(new SettingsValue("ignoreSSLErrors", false, PLATFORM_ANY, main));
  main->registerSetting(new SettingsValue("autodetectCertBundle", false, PLATFORM_ANY, main));
  SettingsComponent::Get().registerSection(main);
}

void TestSystemComponent::testExtractBaseUrl_data()
{
  QTest::addColumn<QString>("input");
  QTest::addColumn<QString>("expected");

  // Standard cases - URLs with /web
  QTest::newRow("https with /web at root")
    << "https://server.com/web/"
    << "https://server.com";

  QTest::newRow("https with /web and custom port")
    << "https://server.com:8096/web/"
    << "https://server.com:8096";

  QTest::newRow("http with /web and port 80")
    << "http://server.com:80/web/"
    << "http://server.com";

  QTest::newRow("https with /web and port 443")
    << "https://server.com:443/web/"
    << "https://server.com";

  QTest::newRow("https with /web at subpath")
    << "https://server.com/jellyfin/web/"
    << "https://server.com/jellyfin";

  QTest::newRow("https with /web, no trailing slash")
    << "https://server.com/jellyfin/web"
    << "https://server.com/jellyfin";

  QTest::newRow("https with nested path before /web")
    << "https://server.com/path/to/jellyfin/web/"
    << "https://server.com/path/to/jellyfin";

  // Case insensitivity
  QTest::newRow("https with /WEB uppercase")
    << "https://server.com/WEB/"
    << "https://server.com";

  QTest::newRow("https with /Web mixed case")
    << "https://server.com/jellyfin/Web/"
    << "https://server.com/jellyfin";

  // Fallback cases - URLs without /web
  QTest::newRow("https root without /web")
    << "https://server.com/"
    << "https://server.com";

  QTest::newRow("https with port, no /web")
    << "https://server.com:8096/"
    << "https://server.com:8096";

  QTest::newRow("http with port 80, no /web")
    << "http://server.com:80/"
    << "http://server.com";

  QTest::newRow("https with port 443, no /web")
    << "https://server.com:443/"
    << "https://server.com";

  QTest::newRow("https with path but no /web")
    << "https://server.com/some/path"
    << "https://server.com";

  QTest::newRow("http root without /web")
    << "http://server.com"
    << "http://server.com";

  // Edge cases - query strings and fragments
  QTest::newRow("https with /web and query string")
    << "https://server.com/web/?foo=bar"
    << "https://server.com";

  QTest::newRow("https with /web and fragment")
    << "https://server.com/web/#section"
    << "https://server.com";

  QTest::newRow("https with /web, query and fragment")
    << "https://server.com/jellyfin/web/?foo=bar#section"
    << "https://server.com/jellyfin";

  // Edge cases - partial matches
  QTest::newRow("https with /website (not /web)")
    << "https://server.com/website/"
    << "https://server.com";

  QTest::newRow("https with /webdav (not /web)")
    << "https://server.com/webdav/"
    << "https://server.com";

  QTest::newRow("nested /website is not a web-client directory")
    << "https://server.com/jellyfin/website/"
    << "https://server.com";

  QTest::newRow("a partial match after /web must not replace the base")
    << "https://server.com/jellyfin/web/website/"
    << "https://server.com/jellyfin";

  QTest::newRow("encoded base path")
    << "https://server.com/jelly%20fin/web/"
    << "https://server.com/jelly%20fin";

  QTest::newRow("encoded slash stays encoded")
    << "https://server.com/jelly%2Ffin/web/"
    << "https://server.com/jelly%2Ffin";

  QTest::newRow("userinfo query and fragment are removed")
    << "https://user:password@server.com:443/jellyfin/web/?key=value#section"
    << "https://server.com/jellyfin";

  // Edge cases - multiple /web occurrences (should use last)
  QTest::newRow("https with multiple /web - uses last")
    << "https://server.com/web/something/web/"
    << "https://server.com/web/something";

  // Edge cases - localhost and IP addresses
  QTest::newRow("localhost with port")
    << "http://localhost:8096/web/"
    << "http://localhost:8096";

  QTest::newRow("IPv4 address")
    << "http://192.168.1.100:8096/web/"
    << "http://192.168.1.100:8096";

  QTest::newRow("IPv6 address")
    << "http://[::1]:8096/web/"
    << "http://[::1]:8096";

  QTest::newRow("IPv6 default port and subpath")
    << "https://[2001:db8::1]:443/jellyfin/web/"
    << "https://[2001:db8::1]/jellyfin";

  QTest::newRow("IPv6 without /web")
    << "http://[::1]:8096/"
    << "http://[::1]:8096";

  // Edge cases - malformed/empty
  QTest::newRow("empty string")
    << ""
    << "";

  QTest::newRow("no scheme")
    << "server.com/web/"
    << "";

  QTest::newRow("only scheme")
    << "https://"
    << "";

  QTest::newRow("no host")
    << "https:///web/"
    << "";

  QTest::newRow("unsupported scheme")
    << "file:///web/"
    << "";
}

void TestSystemComponent::testExtractBaseUrl()
{
  QFETCH(QString, input);
  QFETCH(QString, expected);

  QString result = SystemComponent::extractBaseUrl(input);

  QCOMPARE(result, expected);
}

void TestSystemComponent::replacingPendingRequest_data()
{
  QTest::addColumn<bool>("checkingInfo");
  QTest::addColumn<bool>("sameUrl");
  QTest::newRow("resolve-new-url") << false << false;
  QTest::newRow("resolve-same-url") << false << true;
  QTest::newRow("info-new-url") << true << false;
  QTest::newRow("info-same-url") << true << true;
}

void TestSystemComponent::replacingPendingRequest()
{
  QFETCH(bool, checkingInfo);
  QFETCH(bool, sameUrl);
  ConnectivityServer server;
  QVERIFY(server.listen(QHostAddress::LocalHost));
  server.answerHead = checkingInfo;
  server.answerInfo = false;
  SystemComponent system;
  system.m_networkManager->setProxy(QNetworkProxy::NoProxy);
  QSignalSpy results(&system, &SystemComponent::serverConnectivityResult);
  const auto firstUrl = server.url("/first/web/");
  system.checkServerConnectivity(firstUrl, "first-attempt");
  QTRY_COMPARE_WITH_TIMEOUT(server.requests.size(), checkingInfo ? 2 : 1, 2000);
  auto* previous = checkingInfo ? system.m_connectivityCheckReply : system.m_resolveUrlReply;
  QVERIFY(previous);
  QSignalSpy finished(previous, &QNetworkReply::finished);

  server.answerHead = server.answerInfo = true;
  const auto nextUrl = sameUrl ? firstUrl : server.url("/second/web/");
  system.checkServerConnectivity(nextUrl, "next-attempt");
  QCOMPARE(finished.count(), 1); // abort() synchronously invokes the old finished handler.
  QTRY_COMPARE_WITH_TIMEOUT(results.count(), 1, 2000);
  QCOMPARE(results.first().at(0).toString(), nextUrl);
  QVERIFY(results.first().at(1).toBool());
  QCOMPARE(results.first().at(2).toString(), nextUrl);
  QCOMPARE(results.first().at(3).toString(), QString("next-attempt"));
  QVERIFY(!system.m_connectivityCheckReply);
  QVERIFY(!system.m_resolveUrlReply);
  QVERIFY(!system.m_connectivityRetryTimer->isActive());
}

void TestSystemComponent::replacingStandaloneResolve()
{
  ConnectivityServer server;
  QVERIFY(server.listen(QHostAddress::LocalHost));
  server.answerHead = false;
  SystemComponent system;
  system.m_networkManager->setProxy(QNetworkProxy::NoProxy);
  bool staleCallback = false;
  system.resolveUrl(server.url("/old/web/"), [&](const QString&) { staleCallback = true; });
  QTRY_COMPARE_WITH_TIMEOUT(server.requests.size(), 1, 2000);

  server.answerHead = true;
  QString resolved;
  system.resolveUrl(server.url("/new/web/"), [&](const QString& url) { resolved = url; });
  QTRY_COMPARE_WITH_TIMEOUT(resolved, server.url("/new/web/"), 2000);
  QVERIFY(!staleCallback);
  QVERIFY(!system.m_resolveUrlReply);
}

void TestSystemComponent::timeoutRetries_data()
{
  QTest::addColumn<bool>("checkingInfo");
  QTest::newRow("resolve-timeout") << false;
  QTest::newRow("info-timeout") << true;
}

void TestSystemComponent::timeoutRetries()
{
  QFETCH(bool, checkingInfo);
  ConnectivityServer server;
  QVERIFY(server.listen(QHostAddress::LocalHost));
  server.answerHead = checkingInfo;
  server.answerInfo = false;
  SystemComponent system;
  system.m_networkManager->setProxy(QNetworkProxy::NoProxy);
  QSignalSpy results(&system, &SystemComponent::serverConnectivityResult);
  system.checkServerConnectivity(server.url(), "retry-attempt");
  QTRY_COMPARE_WITH_TIMEOUT(server.requests.size(), checkingInfo ? 2 : 1, 2000);
  auto* reply = checkingInfo ? system.m_connectivityCheckReply : system.m_resolveUrlReply;
  QVERIFY(reply);
  system.setReplyTimeout(reply, 0); // Run the production timeout path without a 30-second wait.
  QTRY_VERIFY_WITH_TIMEOUT(system.m_connectivityRetryTimer->isActive(), 1000);
  QCOMPARE(results.count(), 0);

  server.answerHead = server.answerInfo = true;
  system.m_connectivityRetryTimer->start(0);
  QTRY_COMPARE_WITH_TIMEOUT(results.count(), 1, 2000);
  QVERIFY(results.first().at(1).toBool());
  QCOMPARE(results.first().at(0).toString(), server.url());
  QCOMPARE(results.first().at(3).toString(), QString("retry-attempt"));
  QVERIFY(!system.m_connectivityRetryTimer->isActive());
}

void TestSystemComponent::cancellationStopsRetries_data()
{
  QTest::addColumn<int>("stage");
  QTest::newRow("resolve") << 0;
  QTest::newRow("public-info") << 1;
  QTest::newRow("retry-delay") << 2;
}

void TestSystemComponent::totalDeadline_data()
{
  QTest::addColumn<bool>("invalidInfo");
  QTest::newRow("stalled-head") << false;
  QTest::newRow("invalid-info-across-retries") << true;
}

void TestSystemComponent::totalDeadline()
{
  QFETCH(bool, invalidInfo);
  ConnectivityServer server;
  QVERIFY(server.listen(QHostAddress::LocalHost));
  server.answerHead = invalidInfo;
  server.infoBody = "{}";
  SystemComponent system;
  system.m_networkManager->setProxy(QNetworkProxy::NoProxy);
  QSignalSpy results(&system, &SystemComponent::serverConnectivityResult);
  system.checkServerConnectivity(server.url(), "original");
  QCOMPARE(system.m_connectivityDeadline.interval(), CONNECTIVITY_BUDGET_MS);
  if (invalidInfo) {
    QTRY_VERIFY(system.m_connectivityRetryTimer->isActive());
    const int deadline = system.m_connectivityDeadline.timerId();
    system.m_connectivityRetryTimer->start(0);
    QTRY_COMPARE(server.requests.size(), 4);
    QTRY_VERIFY(system.m_connectivityRetryTimer->isActive());
    QCOMPARE(system.m_connectivityDeadline.timerId(), deadline);
  } else {
    QTRY_COMPARE(server.requests.size(), 1);
  }
  system.m_connectivityDeadline.start(0);
  QTRY_COMPARE(results.size(), 1);
  QCOMPARE(results.first(), QVariantList({server.url(), false, invalidInfo ? "invalidResponse" : "timedOut", "original"}));
  QVERIFY(!system.m_connectivityRetryTimer->isActive());
  QVERIFY(!system.m_resolveUrlReply);
  QVERIFY(!system.m_connectivityCheckReply);
  server.answerHead = true;
  server.infoBody = R"({"Id":"recovered"})";
  system.checkServerConnectivity(server.url(), "retry");
  QTRY_COMPARE(results.size(), 2);
  QVERIFY(results.last().at(1).toBool());
  QCOMPARE(results.last().at(3).toString(), QString("retry"));
  QVERIFY(!system.m_connectivityDeadline.isActive());
}

void TestSystemComponent::cancellationStopsRetries()
{
  QFETCH(int, stage);
  ConnectivityServer server;
  QVERIFY(server.listen(QHostAddress::LocalHost));
  server.answerHead = stage != 0;
  server.answerInfo = stage == 2;
  server.infoBody = "not a Jellyfin response";
  SystemComponent system;
  system.m_networkManager->setProxy(QNetworkProxy::NoProxy);
  QSignalSpy results(&system, &SystemComponent::serverConnectivityResult);
  system.checkServerConnectivity(server.url());
  QTRY_COMPARE_WITH_TIMEOUT(server.requests.size(), stage == 0 ? 1 : 2, 2000);
  if (stage == 2)
    QTRY_VERIFY_WITH_TIMEOUT(system.m_connectivityRetryTimer->isActive(), 2000);
  else
    system.setReplyTimeout(stage == 0 ? system.m_resolveUrlReply : system.m_connectivityCheckReply, 0);

  system.cancelServerConnectivity();
  QVERIFY(!system.m_connectivityRetryTimer->isActive());
  QVERIFY(!system.m_resolveUrlReply);
  QVERIFY(!system.m_connectivityCheckReply);
  QVERIFY(system.m_pendingConnectivityUrl.isEmpty());
  QVERIFY(system.m_pendingConnectivityRequestId.isEmpty());
  QCOMPARE(results.count(), 0);

  // A queued timeout from the cancelled request must not affect the next connection.
  server.answerHead = server.answerInfo = true;
  server.infoBody = R"({"Id":"recovered"})";
  system.checkServerConnectivity(server.url("/next/web/"));
  QTRY_COMPARE_WITH_TIMEOUT(results.count(), 1, 2000);
  QVERIFY(results.first().at(1).toBool());
  QCOMPARE(results.first().at(0).toString(), server.url("/next/web/"));
}

void TestSystemComponent::connectivityUsesBaseUrl_data()
{
  QTest::addColumn<bool>("ipv6");
  QTest::addColumn<QString>("basePath");
  QTest::newRow("reverse-proxy") << false << "/jellyfin";
  QTest::newRow("encoded-reverse-proxy") << false << "/jelly%2Ffin";
  QTest::newRow("ipv6") << true << "/jellyfin";
}

void TestSystemComponent::connectivityUsesBaseUrl()
{
  QFETCH(bool, ipv6);
  QFETCH(QString, basePath);
  ConnectivityServer server;
  if (!server.listen(ipv6 ? QHostAddress::LocalHostIPv6 : QHostAddress::LocalHost))
  {
    if (ipv6)
      QSKIP("IPv6 loopback is unavailable on this host");
    QFAIL("Could not listen on IPv4 loopback");
  }
  SystemComponent system;
  system.m_networkManager->setProxy(QNetworkProxy::NoProxy);
  QSignalSpy results(&system, &SystemComponent::serverConnectivityResult);
  system.checkServerConnectivity(server.url(basePath + "/web/"));
  QTRY_COMPARE_WITH_TIMEOUT(results.count(), 1, 2000);
  QVERIFY(results.first().at(1).toBool());
  QCOMPARE(server.requests.size(), 2);
  QCOMPARE(server.requests.last().method, QByteArray("GET"));
  QCOMPARE(server.requests.last().path, (basePath + "/System/Info/Public").toUtf8());
}

void TestSystemComponent::unsupportedHeadStillChecksServer()
{
  ConnectivityServer server;
  QVERIFY(server.listen(QHostAddress::LocalHost));
  server.headStatus = 405;
  SystemComponent system;
  system.m_networkManager->setProxy(QNetworkProxy::NoProxy);
  QSignalSpy results(&system, &SystemComponent::serverConnectivityResult);
  system.checkServerConnectivity(server.url());
  QTRY_COMPARE_WITH_TIMEOUT(results.count(), 1, 2000);
  QVERIFY(results.first().at(1).toBool());
  QCOMPARE(server.requests.size(), 2);
}

void TestSystemComponent::invalidPublicInfoRetries_data()
{
  QTest::addColumn<QByteArray>("body");
  QTest::newRow("invalid-json") << QByteArray("not json");
  QTest::newRow("missing-id") << QByteArray("{}");
  QTest::newRow("empty-id") << QByteArray(R"({"Id":""})");
  QTest::newRow("numeric-id") << QByteArray(R"({"Id":123})");
}

void TestSystemComponent::invalidPublicInfoRetries()
{
  QFETCH(QByteArray, body);
  ConnectivityServer server;
  QVERIFY(server.listen(QHostAddress::LocalHost));
  server.infoBody = body;
  SystemComponent system;
  system.m_networkManager->setProxy(QNetworkProxy::NoProxy);
  QSignalSpy results(&system, &SystemComponent::serverConnectivityResult);
  system.checkServerConnectivity(server.url());
  QTRY_VERIFY_WITH_TIMEOUT(system.m_connectivityRetryTimer->isActive(), 2000);
  QCOMPARE(results.count(), 0);
  server.infoBody = R"({"Id":"recovered"})";
  system.m_connectivityRetryTimer->start(0);
  QTRY_COMPARE_WITH_TIMEOUT(results.count(), 1, 2000);
  QVERIFY(results.first().at(1).toBool());
}

void TestSystemComponent::invalidAddressFailsImmediately_data()
{
  QTest::addColumn<QString>("url");
  QTest::newRow("empty") << "";
  QTest::newRow("missing-host") << "https:///web/";
  QTest::newRow("invalid-port") << "http://localhost:99999/web/";
  QTest::newRow("userinfo") << "http://user:pass@localhost/web/";
  QTest::newRow("unsupported-scheme") << "ftp://localhost/web/";
}

void TestSystemComponent::invalidAddressFailsImmediately()
{
  QFETCH(QString, url);
  SystemComponent system;
  QSignalSpy results(&system, &SystemComponent::serverConnectivityResult);
  system.checkServerConnectivity(url, "invalid-attempt");
  QCOMPARE(results.count(), 1);
  QCOMPARE(results.first().at(0).toString(), url);
  QVERIFY(!results.first().at(1).toBool());
  QCOMPARE(results.first().at(3).toString(), QString("invalid-attempt"));
  QVERIFY(!system.m_connectivityRetryTimer->isActive());
  QVERIFY(!system.m_resolveUrlReply);
  QVERIFY(!system.m_connectivityCheckReply);
}

QTEST_GUILESS_MAIN(TestSystemComponent)
#include "test_systemcomponent.moc"
