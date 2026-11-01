#include <QtTest/QtTest>
#include <QQuickWindow>
#include <QStandardPaths>
#include <MpvAbstractItem>
#include <MpvController>

class TestableMpvItem : public MpvAbstractItem
{
public:
  using MpvAbstractItem::mpvController;
};

class TestMpvAbstractItem : public QObject
{
  Q_OBJECT

private slots:
  void workerThreadCalls();
};

void TestMpvAbstractItem::workerThreadCalls()
{
  QStandardPaths::setTestModeEnabled(true);
  QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
  TestableMpvItem item;

  for (int i = 0; i < 25; ++i)
  {
    const QString expected = QString("queued title %1").arg(i);
    {
      const QString property = "title";
      const QVariant value = expected;
      item.setProperty(property, value);
    }
    // A blocking read is also a barrier for the preceding queued worker call.
    QCOMPARE(item.getProperty("title").toString(), expected);
    QVERIFY(item.setPropertyBlocking("title", QString("blocking title")) >= 0);
    QCOMPARE(item.expandText("${title}").toString(), QString("blocking title"));
    item.command({"set", "title", "command title"});
    QCOMPARE(item.getProperty("title").toString(), QString("command title"));
  }

  item.setPropertyAsync("title", QString("async property"), 11);
  QTRY_COMPARE(item.getProperty("title").toString(), QString("async property"));
  item.commandAsync({"set", "title", "async command"}, 12);
  QTRY_COMPARE(item.getProperty("title").toString(), QString("async command"));

  QSignalSpy replies(item.mpvController(), &MpvController::asyncReply);
  item.getPropertyAsync("title", 13);
  const auto getReply = [&replies]() -> QVariantList {
    for (const auto &reply : replies)
    {
      const auto event = qvariant_cast<mpv_event>(reply.at(1));
      if (event.event_id == MPV_EVENT_GET_PROPERTY_REPLY && event.reply_userdata == 13)
        return reply;
    }
    return {};
  };
  QTRY_VERIFY(!getReply().isEmpty());
  QCOMPARE(getReply().at(0).toString(), QString("async command"));
  item.observeProperty("pause", MPV_FORMAT_FLAG, 14);
  QVERIFY(item.unobserveProperty(14) >= 0);
  QVERIFY(item.setPropertyBlocking("not-a-real-property", 1) < 0);
  QVERIFY(item.commandBlocking({"not-a-real-command"}).value<ErrorReturn>().error < 0);
}

QTEST_MAIN(TestMpvAbstractItem)
#include "test_mpvabstractitem.moc"
