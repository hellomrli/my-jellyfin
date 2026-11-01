#include <QtTest/QtTest>
#include <QStandardPaths>
#include <MpvController>

class TestMpvController : public QObject
{
  Q_OBJECT

private slots:
  void inputNodeLifetime();
};

void TestMpvController::inputNodeLifetime()
{
  QStandardPaths::setTestModeEnabled(true);
  MpvController controller;
  controller.init();

  const QVariantMap nested{
    {"name", QString("outer")},
    {"values", QVariantList{QString("inner"), 42, QVariantMap{{"key", QString("value")}}}}
  };

  // Also run this target under LeakSanitizer: every call allocates input nodes.
  for (int i = 0; i < 1000; ++i)
  {
    QVERIFY(controller.setProperty("title", QString("test title")) >= 0);
    QVERIFY(controller.setPropertyAsync("title", QString("async title"), 1) >= 0);
    QCOMPARE(controller.command({"expand-text", "test text"}).toString(), QString("test text"));
    QVERIFY(controller.commandAsync(QStringList{"expand-text", "async text"}, 2) >= 0);
    QVERIFY(controller.setProperty("not-a-real-property", nested) < 0);
    mpv_wait_async_requests(controller.mpv());
    QCoreApplication::processEvents();
  }

  QCOMPARE(controller.getProperty("title").toString(), QString("async title"));
  QVERIFY(controller.command({"not-a-real-command"}).value<ErrorReturn>().error < 0);
  QVERIFY(controller.commandAsync(QVariantMap{{"name", "not-a-real-command"}, {"value", nested}}, 3) < 0);
}

QTEST_GUILESS_MAIN(TestMpvController)
#include "test_mpvcontroller.moc"
