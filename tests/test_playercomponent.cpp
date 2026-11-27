#include <QtTest/QtTest>
#include <QQmlContext>
#include <QQmlEngine>
#include <QQmlExpression>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <MpvController>
#include <limits>

#include "player/PlayerComponent.h"
#include "core/ProfileManager.h"
#include "settings/SettingsComponent.h"
#include "settings/SettingsSection.h"
#include "shared/Paths.h"

class AudioDevicePlayer : public PlayerComponent
{
public:
  QVariantList devices{QVariantMap{{"name", "auto"}, {"description", "Default"}}};

  QVariant getAudioDeviceList() override { return devices; }
};

class TestPlayerComponent : public QObject
{
  Q_OBJECT

private slots:
  void initTestCase();
  void positionNotificationsUseMilliseconds();
  void unavailablePositionClearsCache();
  void durationConversion_data();
  void durationConversion();
  void unavailableDurationClearsCache();
  void fileBoundariesResetTimeline();
  void videoVisibilityUpdatesQmlWhilePaused();
  void invalidAudioDevice_data();
  void invalidAudioDevice();
  void disconnectedAudioDeviceIsRetained();
  void spdifFilterTracksFormat();

private:
  static void property(PlayerComponent& player, const char* name, mpv_format format, void* data = nullptr)
  {
    mpv_event_property change{name, format, data};
    mpv_event event{};
    event.event_id = MPV_EVENT_PROPERTY_CHANGE;
    event.data = &change;
    player.handleMpvEvent(&event);
  }

  static void time(PlayerComponent& player, const char* name, double seconds)
  {
    property(player, name, MPV_FORMAT_DOUBLE, &seconds);
  }

  QTemporaryDir m_config;
  SettingsSection* m_audio = nullptr;
};

void TestPlayerComponent::initTestCase()
{
  QStandardPaths::setTestModeEnabled(true);
  QVERIFY(m_config.isValid());
  Paths::setConfigDir(m_config.path());
  Paths::setCacheDir(m_config.path());
  ProfileManager::Get().setActiveProfile(ProfileManager::createProfile("Player tests"));
  m_audio = new SettingsSection(SETTINGS_SECTION_AUDIO, PLATFORM_ANY, -1, &SettingsComponent::Get());
  m_audio->registerSetting(new SettingsValue("device", QString("auto"), PLATFORM_ANY, m_audio));
  SettingsComponent::Get().registerSection(m_audio);
}

void TestPlayerComponent::positionNotificationsUseMilliseconds()
{
  PlayerComponent player;
  QSignalSpy positions(&player, &PlayerComponent::positionUpdate);
  QCOMPARE(player.getPosition(), 0);
  QCOMPARE(player.getDuration(), 0);

  time(player, "playback-time", 0);
  QCOMPARE(positions.count(), 1); // The first sample must be delivered, including zero.
  QCOMPARE(positions.last().first().toULongLong(), quint64(0));

  time(player, "playback-time", 0.040);
  time(player, "playback-time", 0.099);
  QCOMPARE(positions.count(), 1);
  QCOMPARE(player.getPosition(), 99); // SyncPlay still sees the latest sample.

  time(player, "playback-time", 0.100);
  QCOMPARE(positions.count(), 2);
  QCOMPARE(positions.last().first().toULongLong(), quint64(100));

  time(player, "playback-time", 12.3456);
  QCOMPARE(player.getPosition(), 12346);
  QCOMPARE(positions.last().first().toULongLong(), quint64(12346));
  time(player, "playback-time", 2.5); // Backward seeks must also notify.
  QCOMPARE(positions.last().first().toULongLong(), quint64(2500));

  const auto count = positions.count();
  time(player, "playback-time", std::numeric_limits<double>::quiet_NaN());
  time(player, "playback-time", std::numeric_limits<double>::infinity());
  QCOMPARE(player.getPosition(), 2500);
  QCOMPARE(positions.count(), count);
  time(player, "playback-time", -0.5);
  QCOMPARE(player.getPosition(), 0);
  QCOMPARE(positions.last().first().toULongLong(), quint64(0));
}

void TestPlayerComponent::unavailablePositionClearsCache()
{
  PlayerComponent player;
  QSignalSpy positions(&player, &PlayerComponent::positionUpdate);
  time(player, "playback-time", 45);
  property(player, "playback-time", MPV_FORMAT_NONE);
  QCOMPARE(player.getPosition(), 0);
  QCOMPARE(positions.count(), 1); // Do not overwrite the web client's final stop position.
  time(player, "playback-time", 45.010);
  QCOMPARE(positions.count(), 2); // A fresh sample must bypass the old throttle.
}

void TestPlayerComponent::durationConversion_data()
{
  QTest::addColumn<double>("seconds");
  QTest::addColumn<qint64>("milliseconds");
  QTest::newRow("fractional") << 12.3456 << qint64(12346);
  QTest::newRow("long-movie") << 9876.543 << qint64(9876543);
  QTest::newRow("zero") << 0.0 << qint64(0);
  QTest::newRow("negative") << -1.0 << qint64(0);
  QTest::newRow("nan") << std::numeric_limits<double>::quiet_NaN() << qint64(0);
  QTest::newRow("infinity") << std::numeric_limits<double>::infinity() << qint64(0);
  QTest::newRow("overflow") << (std::numeric_limits<double>::max)() << qint64(0);
}

void TestPlayerComponent::durationConversion()
{
  QFETCH(double, seconds);
  QFETCH(qint64, milliseconds);
  PlayerComponent player;
  QSignalSpy durations(&player, &PlayerComponent::updateDuration);
  time(player, "duration", seconds);
  QCOMPARE(player.getDuration(), milliseconds);
  QCOMPARE(durations.count(), 1);
  QCOMPARE(durations.first().first().toLongLong(), milliseconds);
}

void TestPlayerComponent::unavailableDurationClearsCache()
{
  PlayerComponent player;
  QSignalSpy durations(&player, &PlayerComponent::updateDuration);
  time(player, "duration", 120);
  property(player, "duration", MPV_FORMAT_NONE);
  QCOMPARE(player.getDuration(), 0);
  QCOMPARE(durations.count(), 2);
  QCOMPARE(durations.last().first().toLongLong(), 0);
}

void TestPlayerComponent::fileBoundariesResetTimeline()
{
  PlayerComponent player;
  QSignalSpy positions(&player, &PlayerComponent::positionUpdate);
  time(player, "playback-time", 30);
  time(player, "duration", 120);

  mpv_event event{};
  event.event_id = MPV_EVENT_START_FILE;
  player.handleMpvEvent(&event);
  QCOMPARE(player.getPosition(), 0);
  QCOMPARE(player.getDuration(), 0);
  time(player, "playback-time", 30.010);
  QCOMPARE(positions.count(), 2);
  time(player, "duration", 90);

  mpv_event_end_file end{};
  end.reason = MPV_END_FILE_REASON_STOP;
  event.event_id = MPV_EVENT_END_FILE;
  event.data = &end;
  player.handleMpvEvent(&event);
  QCOMPARE(player.getPosition(), 0);
  QCOMPARE(player.getDuration(), 0);
  QCOMPARE(positions.count(), 2);
}

void TestPlayerComponent::videoVisibilityUpdatesQmlWhilePaused()
{
  PlayerComponent player;
  QQmlEngine engine;
  engine.rootContext()->setContextProperty("player", &player);
  QQmlExpression visible(engine.rootContext(), nullptr, "player.videoWindowVisible");
  visible.setNotifyOnValueChanged(true);
  QSignalSpy changes(&visible, &QQmlExpression::valueChanged);
  QCOMPARE(visible.evaluate().toBool(), false);
  QVERIFY(!visible.hasError());

  int enabled = 1;
  property(player, "vo-configured", MPV_FORMAT_FLAG, &enabled);
  QCOMPARE(changes.count(), 1);
  QCOMPARE(visible.evaluate().toBool(), true);
  property(player, "pause", MPV_FORMAT_FLAG, &enabled);
  QCOMPARE(visible.evaluate().toBool(), true);
  QCOMPARE(changes.count(), 1);

  int disabled = 0;
  property(player, "vo-configured", MPV_FORMAT_FLAG, &disabled);
  QCOMPARE(changes.count(), 2);
  QCOMPARE(visible.evaluate().toBool(), false);
}

void TestPlayerComponent::spdifFilterTracksFormat()
{
  MpvController controller;
  controller.init();
  PlayerComponent player;
  player.setMpvController(&controller);
  player.m_doAc3Transcoding = true;
  player.m_passthroughCodecs = {"ac3", "dts"};
  const auto filters = [&controller]() { return controller.getProperty("af").toList(); };
  for (const QString& codec : {QString("aac"), QString("flac")}) {
    player.updateAc3Filter(codec, 6);
    QCOMPARE(filters().size(), 1);
    QCOMPARE(filters().first().toMap().value("label").toString(), QString("ac3"));
  }
  for (const QString& codec : player.m_passthroughCodecs) {
    player.updateAc3Filter(codec, 6);
    QVERIFY(filters().isEmpty());
  }
  player.updateAc3Filter("pcm_s16le", 2);
  QVERIFY(filters().isEmpty());
  player.updateAc3Filter("pcm_s16le", 6);
  QCOMPARE(filters().size(), 1);
  player.m_doAc3Transcoding = false;
  player.updateAc3Filter("pcm_s16le", 6);
  QVERIFY(filters().isEmpty());
}

void TestPlayerComponent::invalidAudioDevice_data()
{
  QTest::addColumn<QVariant>("setting");
  QTest::newRow("boolean") << QVariant(false);
  QTest::newRow("integer") << QVariant(42);
  QTest::newRow("list") << QVariant(QVariantList{QString("auto")});
  QTest::newRow("object") << QVariant(QVariantMap{{"name", "auto"}});
}

void TestPlayerComponent::invalidAudioDevice()
{
  QFETCH(QVariant, setting);
  m_audio->setValueNoSave("device", setting);
  MpvController controller;
  controller.init();
  AudioDevicePlayer player;
  player.setMpvController(&controller);
  player.updateAudioDeviceList();
  QCOMPARE(m_audio->possibleValues("device").size(), 1);

  QSignalSpy changes(m_audio, &SettingsSection::valuesUpdated);
  player.updateAudioDevice();
  QCOMPARE(m_audio->value("device"), QVariant(QString("auto")));
  QCOMPARE(controller.getProperty("audio-device").toString(), QString("auto"));
  QCOMPARE(changes.count(), 1);
  player.updateAudioDevice();
  QCOMPARE(changes.count(), 1);

  QFile saved(ProfileManager::activeProfile().dataDir("jellyfin-desktop.conf"));
  QVERIFY(saved.open(QIODevice::ReadOnly));
  const auto config = QJsonDocument::fromJson(saved.readAll()).object();
  QCOMPARE(config["sections"].toObject()["audio"].toObject()["device"].toString(), QString("auto"));
}

void TestPlayerComponent::disconnectedAudioDeviceIsRetained()
{
  const QString selected("test/output");
  m_audio->setValueNoSave("device", selected);
  MpvController controller;
  controller.init();
  AudioDevicePlayer player;
  player.setMpvController(&controller);
  player.updateAudioDeviceList();
  QCOMPARE(m_audio->possibleValues("device").last().toMap()["value"].toString(), selected);
  player.updateAudioDevice();
  QCOMPARE(controller.getProperty("audio-device").toString(), QString("auto"));
  QCOMPARE(m_audio->value("device").toString(), selected);

  player.devices.append(QVariantMap{{"name", selected}, {"description", "Reconnected output"}});
  player.updateAudioDeviceList();
  player.updateAudioDevice();
  QCOMPARE(controller.getProperty("audio-device").toString(), selected);
  QCOMPARE(m_audio->possibleValues("device").size(), 2);
  QCOMPARE(m_audio->value("device").toString(), selected);
}

QTEST_GUILESS_MAIN(TestPlayerComponent)
#include "test_playercomponent.moc"
