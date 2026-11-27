#include <QtTest/QtTest>
#include <QProcess>
#include <QScopeGuard>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QTextStream>
#include "core/ProfileManager.h"
#include "shared/Names.h"
#include "shared/Paths.h"
#include "../src/utils/Log.h"

class TestLog : public QObject
{
  Q_OBJECT

private slots:
  // ParseLogLevel tests
  void testParseLogLevel_data();
  void testParseLogLevel();

  // CensorAuthTokens tests
  void testCensorAuthTokens_data();
  void testCensorAuthTokens();

  void testLogLifecycle_data();
  void testLogLifecycle();
};

///////////////////////////////////////////////////////////////////////////////
// ParseLogLevel
///////////////////////////////////////////////////////////////////////////////

void TestLog::testParseLogLevel_data()
{
  QTest::addColumn<QString>("input");
  QTest::addColumn<int>("expected");

  // Log levels.
  QTest::newRow("debug") << "debug" << 0;
  QTest::newRow("info")  << "info"  << 1;
  QTest::newRow("warn")  << "warn"  << 2;
  QTest::newRow("error") << "error" << 3;
  QTest::newRow("fatal") << "fatal" << 4;

  // Invalid log levels.
  QTest::newRow("empty string")    << ""         << -1;
  QTest::newRow("unknown level")   << "whoohoo"  << -1;
  QTest::newRow("numeric")         << "0"        << -1;
  QTest::newRow("uppercase DEBUG") << "DEBUG"    << -1;
  QTest::newRow("mixed case Info") << "InFo"     << -1;
  QTest::newRow("warning")         << "warning"  << -1;
  QTest::newRow("critical")        << "critical" << -1;
  QTest::newRow("space before")    << " debug"   << -1;
  QTest::newRow("trailing space")  << "debug "   << -1;
}

void TestLog::testParseLogLevel()
{
  QFETCH(QString, input);
  QFETCH(int, expected);

  QCOMPARE(Log::ParseLogLevel(input), expected);
}

///////////////////////////////////////////////////////////////////////////////
// CensorAuthTokens
///////////////////////////////////////////////////////////////////////////////

void TestLog::testCensorAuthTokens_data()
{
  QTest::addColumn<QString>("input");
  QTest::addColumn<QString>("expected");

  const QString masked32 = QString(32, 'x');
  QTest::newRow("remote URL credentials query and fragment")
    << "two URLs: HTTPS://user:pass@[::1]:8096/base%2Fpath?q=private#part http://host/web/#secret"
    << "two URLs: HTTPS://[::1]:8096/base%2Fpath http://host/web/";

  // Base case: No tokens in string
  QTest::newRow("no token")
  << "GET /Items?UserId=abc123"
  << "GET /Items?UserId=abc123";

  // Base case: Empty string
  QTest::newRow("empty string")
  << ""
  << "";

  // API key
  QTest::newRow("api_key")
    << "url?api_key=abcdef0123456789abcdef0123456789&other=1"
    << "url?api_key=" + masked32 + "&other=1";

  // X-MediaBrowser-Token, URL-encoded
  QTest::newRow("X-MediaBrowser-Token URL-encoded")
    << "header=X-MediaBrowser-Token%3Dabcdef0123456789abcdef0123456789done"
    << "header=X-MediaBrowser-Token%3D" + masked32 + "done";

  // X-MediaBrowser-Token, plain
  QTest::newRow("X-MediaBrowser-Token plain")
    << "X-MediaBrowser-Token=abcdef0123456789abcdef0123456789end"
    << "X-MediaBrowser-Token=" + masked32 + "end";

  // ApiKey= pattern
  QTest::newRow("ApiKey")
    << "ApiKey=abcdef0123456789abcdef0123456789rest"
    << "ApiKey=" + masked32 + "rest";

  // AccessToken= pattern
  QTest::newRow("AccessToken=")
    << "AccessToken=abcdef0123456789abcdef0123456789end"
    << "AccessToken=" + masked32 + "end";

  // AccessToken":" pattern (appears to be JSON formatted)
  QTest::newRow("AccessToken JSON")
    << R"({"AccessToken":"abcdef0123456789abcdef0123456789"})"
    << R"({"AccessToken":")" + masked32 + R"("})";

  // Multiple tokens
  QTest::newRow("two api_key tokens")
    << "url?api_key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&redirect=url2?api_key=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
    << "url?api_key=" + masked32 + "&redirect=url2?api_key=" + masked32;

  QTest::newRow("mixed token types")
    << "api_key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA and AccessToken=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
    << "api_key=" + masked32 + " and AccessToken=" + masked32;

  // Truncated token
  QTest::newRow("api_key truncated at end")
    << "api_key=short"
    << "api_key=short";

  QTest::newRow("api_key exactly 32 chars at end")
    << "api_key=abcdef0123456789abcdef0123456789"
    << "api_key=" + masked32;

  // Not quite an API key
  QTest::newRow("partial pattern match")
    << "not_an_api_key=something"
    << "not_an_api_key=something";

  // Token with multiple parameters
  QTest::newRow("token in log line")
    << "2024-01-01 12:00:00 [info] Request GET /Items?api_key=abcdef0123456789abcdef0123456789&format=json"
    << "2024-01-01 12:00:00 [info] Request GET /Items?api_key=" + masked32 + "&format=json";
}

void TestLog::testCensorAuthTokens()
{
  QFETCH(QString, input);
  QFETCH(QString, expected);

  QString msg = input;
  Log::CensorAuthTokens(msg);
  QCOMPARE(msg, expected);
}

void TestLog::testLogLifecycle_data()
{
  QTest::addColumn<QString>("scenario");
  QTest::newRow("normal") << QString("normal");
  QTest::newRow("missing-directory") << QString("missing-directory");
  QTest::newRow("rotation-after-cleanup") << QString("rotation-after-cleanup");
  QTest::newRow("blocked-directory") << QString("blocked-directory");
}

void TestLog::testLogLifecycle()
{
  QFETCH(QString, scenario);
  QTemporaryDir config;
  QVERIFY(config.isValid());
  QProcess worker;
  worker.start(QCoreApplication::applicationFilePath(), {"--log-scenario", scenario, config.path()});
  QVERIFY(worker.waitForStarted());
  const bool finished = worker.waitForFinished(5000);
  if (!finished)
  {
    worker.kill();
    worker.waitForFinished(1000);
  }
  const auto errors = worker.readAllStandardError();
  const QString logDir = QString::fromUtf8(worker.readAllStandardOutput()).trimmed();
  QVERIFY(!logDir.isEmpty());
  // macOS keeps profile logs outside the overridden config directory.
  const auto cleanupLogs = qScopeGuard([logDir] {
    if (QFileInfo(logDir).isDir())
      QDir(logDir).removeRecursively();
    else
      QFile::remove(logDir);
  });
  QVERIFY2(finished, "Logging did not finish within five seconds; possible deadlock");
  QVERIFY2(worker.exitStatus() == QProcess::NormalExit && worker.exitCode() == 0, errors.constData());

  if (scenario == "blocked-directory")
  {
    QVERIFY(errors.contains("Failed to create temporary log file"));
    QVERIFY(errors.contains("Failed to open main log file"));
    return;
  }

  const QString logPath = logDir + "/" + Names::DataName() + ".log";
  QFile current(logPath);
  QFile previous(logPath + ".1");
  QVERIFY(current.open(QIODevice::ReadOnly));
  QVERIFY(previous.open(QIODevice::ReadOnly));
  const auto currentText = current.readAll();
  const auto previousText = previous.readAll();
  QVERIFY(currentText.contains("LOG_SECOND_ROTATION"));
  QVERIFY(!currentText.contains("LOG_FIRST_ROTATION"));
  QVERIFY(previousText.contains("LOG_FIRST_ROTATION"));
  if (scenario != "rotation-after-cleanup")
  {
    QVERIFY(previousText.contains("LOG_INITIAL api_key=" + QByteArray(32, 'x')));
    QVERIFY(!previousText.contains("abcdef0123456789abcdef0123456789"));
  }
  QVERIFY(QDir(logDir).entryList({"jellyfin-desktop-*.log"}, QDir::Files).isEmpty());
}

// Run logger scenarios in a child process so a mutex deadlock has a bounded
// failure, and replacing Qt's message handler cannot hide Qt Test assertions.
static int runLogScenario(const QString& scenario, const QString& configDir)
{
  QStandardPaths::setTestModeEnabled(true);
  Paths::setConfigDir(configDir);
  Paths::setCacheDir(configDir);
  ProfileManager::Get().setActiveProfile(ProfileManager::createProfile("Log tests"));
  const QString logDir = ProfileManager::activeProfile().logDir();
  QTextStream output(stdout);
  output << logDir << '\n';
  output.flush();

  if (scenario == "missing-directory" || scenario == "blocked-directory")
  {
    if (!QDir(logDir).removeRecursively())
      return 1;
    if (scenario == "blocked-directory")
    {
      QFile blocker(logDir);
      if (!blocker.open(QIODevice::WriteOnly))
        return 1;
    }
  }

  Log::Init();
  qInfo("LOG_INITIAL api_key=abcdef0123456789abcdef0123456789");
  if (scenario == "rotation-after-cleanup")
    Log::Cleanup();
  Log::RotateLog();
  qInfo("LOG_FIRST_ROTATION");
  Log::RotateLog();
  qInfo("LOG_SECOND_ROTATION");
  Log::Cleanup();
  return 0;
}

int main(int argc, char** argv)
{
  QCoreApplication app(argc, argv);
  const auto arguments = app.arguments();
  if (arguments.size() == 4 && arguments[1] == "--log-scenario")
    return runLogScenario(arguments[2], arguments[3]);
  TestLog test;
  return QTest::qExec(&test, argc, argv);
}

#include "test_log.moc"
