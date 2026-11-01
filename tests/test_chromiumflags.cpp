#include <QtTest/QtTest>
#include <QProcess>
#include "utils/ChromiumFlags.h"

class TestChromiumFlags : public QObject
{
  Q_OBJECT

private slots:
  void defaults();
  void preservesUserFlags();
  void disablesGpu();
  void optionalFlags();
};

void TestChromiumFlags::defaults()
{
  const auto flags = chromiumFlags({}, false, false, false);
  QVERIFY(flags.contains("--lang=zh-CN"));
  QVERIFY(flags.contains("--enable-gpu-rasterization"));
  QVERIFY(flags.contains("MediaSessionService"));
  QVERIFY(!flags.contains("--ignore-certificate-errors"));
  QVERIFY(!flags.contains("--disable-pinch"));
}

void TestChromiumFlags::preservesUserFlags()
{
  const QString supplied = "--lang=en-US --js-flags=\"--expose-gc --trace-gc\" --disable-features=UserFeature";
  const auto flags = chromiumFlags(supplied, false, false, false);
  QVERIFY(flags.startsWith(supplied + " "));
  QVERIFY(!flags.contains("--lang=zh-CN"));
  const auto parsed = QProcess::splitCommand(flags);
  QVERIFY(parsed.contains("--js-flags=--expose-gc --trace-gc"));
  QVERIFY(parsed.last().contains("UserFeature,MediaSessionService"));
}

void TestChromiumFlags::disablesGpu()
{
  auto flags = chromiumFlags({}, true, false, false);
  QVERIFY(flags.contains("--disable-gpu"));
  QVERIFY(!flags.contains("--enable-gpu-rasterization"));
  flags = chromiumFlags("--disable-gpu", false, false, false);
  QCOMPARE(flags.count("--disable-gpu"), 1);
  QVERIFY(!flags.contains("--enable-gpu-rasterization"));
  flags = chromiumFlags("--disable-gpu-rasterization", false, false, false);
  QVERIFY(!flags.contains("--enable-gpu-rasterization"));
}

void TestChromiumFlags::optionalFlags()
{
  const auto flags = chromiumFlags("--disable-pinch", false, true, true);
  QCOMPARE(flags.count("--disable-pinch"), 1);
  QVERIFY(flags.contains("--ignore-certificate-errors"));
}

QTEST_APPLESS_MAIN(TestChromiumFlags)
#include "test_chromiumflags.moc"
