/*
 * SPDX-FileCopyrightText: 2023 George Florea Bănuș <georgefb899@gmail.com>
 *
 * SPDX-License-Identifier: LGPL-2.1-only OR LGPL-3.0-only OR LicenseRef-KDE-Accepted-LGPL
 */

#include "mpvabstractitem.h"
#include "mpvabstractitem_p.h"

#include <QLoggingCategory>
#include <QQuickWindow>
#include <QThread>

#include "mpvcontroller.h"
#include "mpvrenderer.h"

Q_LOGGING_CATEGORY(MpvQt_MpvAbstractItem, "MpvQt.MpvAbstractItem")

MpvAbstractItemPrivate::MpvAbstractItemPrivate(MpvAbstractItem *q)
    : q_ptr(q)
{
}

MpvAbstractItem::MpvAbstractItem(QQuickItem *parent)
    : QQuickFramebufferObject(parent)
    , d_ptr{std::make_unique<MpvAbstractItemPrivate>(this)}
{
    if (QQuickWindow::graphicsApi() != QSGRendererInterface::OpenGL) {
        qCCritical(MpvQt_MpvAbstractItem) << "The graphics api must be set to opengl "
                                             "or mpv won't be able to render the video.\n"
                                             "QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL)\n"
                                             "The call to the function must happen before constructing "
                                             "the first QQuickWindow in the application.";
    }

    d_ptr->m_workerThread = new QThread(this);
    d_ptr->m_mpvController = new MpvController;

    connect(d_ptr->m_workerThread, &QThread::finished, d_ptr->m_mpvController, &MpvController::deleteLater);

    d_ptr->m_mpvController->moveToThread(d_ptr->m_workerThread);
    d_ptr->m_workerThread->start();

    // must wait for init to finish or the mpv object could be accessed while not initialized
    QMetaObject::invokeMethod(d_ptr->m_mpvController, &MpvController::init, Qt::BlockingQueuedConnection);

    auto mpvHandleManager = mpvController()->mpvHandleManager();
    auto renderContext{nullptr};
    d_ptr->m_mpvResourceManager = std::make_shared<MpvResourceManager>(renderContext, mpvHandleManager);
}

MpvAbstractItem::~MpvAbstractItem()
{
    d_ptr->m_workerThread->quit();
    d_ptr->m_workerThread->wait();
    d_ptr->m_workerThread->deleteLater();
}

QQuickFramebufferObject::Renderer *MpvAbstractItem::createRenderer() const
{
    return new MpvRenderer();
}

MpvController *MpvAbstractItem::mpvController()
{
    return d_ptr->m_mpvController;
}

void MpvAbstractItem::observeProperty(const QString &property, mpv_format format, uint64_t id)
{
    auto *controller = d_ptr->m_mpvController;
    // Copy queued arguments; the functor overload also supports older distro Qt.
    QMetaObject::invokeMethod(controller, [controller, property, format, id] {
        controller->observeProperty(property, format, id);
    }, Qt::QueuedConnection);
}

int MpvAbstractItem::unobserveProperty(uint64_t id)
{
    int result = 0;
    auto *controller = d_ptr->m_mpvController;
    QMetaObject::invokeMethod(controller, [controller, id, &result] {
        result = controller->unobserveProperty(id);
    }, Qt::BlockingQueuedConnection);

    return result;
}

void MpvAbstractItem::setProperty(const QString &property, const QVariant &value)
{
    auto *controller = d_ptr->m_mpvController;
    QMetaObject::invokeMethod(controller, [controller, property, value] {
        controller->setProperty(property, value);
    }, Qt::QueuedConnection);
}

int MpvAbstractItem::setPropertyBlocking(const QString &property, const QVariant &value)
{
    int error = 0;
    auto *controller = d_ptr->m_mpvController;
    QMetaObject::invokeMethod(controller, [controller, property, value, &error] {
        error = controller->setProperty(property, value);
    }, Qt::BlockingQueuedConnection);

    return error;
}

void MpvAbstractItem::setPropertyAsync(const QString &property, const QVariant &value, int id)
{
    auto *controller = d_ptr->m_mpvController;
    QMetaObject::invokeMethod(controller, [controller, property, value, id] {
        controller->setPropertyAsync(property, value, id);
    }, Qt::QueuedConnection);
}

QVariant MpvAbstractItem::getProperty(const QString &property)
{
    QVariant value;
    auto *controller = d_ptr->m_mpvController;
    QMetaObject::invokeMethod(controller, [controller, property, &value] {
        value = controller->getProperty(property);
    }, Qt::BlockingQueuedConnection);

    return value;
}

void MpvAbstractItem::getPropertyAsync(const QString &property, int id)
{
    auto *controller = d_ptr->m_mpvController;
    QMetaObject::invokeMethod(controller, [controller, property, id] {
        controller->getPropertyAsync(property, id);
    }, Qt::QueuedConnection);
}

void MpvAbstractItem::command(const QStringList &params)
{
    auto *controller = d_ptr->m_mpvController;
    QMetaObject::invokeMethod(controller, [controller, params] {
        controller->command(params);
    }, Qt::QueuedConnection);
}

QVariant MpvAbstractItem::commandBlocking(const QStringList &params)
{
    QVariant value;
    auto *controller = d_ptr->m_mpvController;
    QMetaObject::invokeMethod(controller, [controller, params, &value] {
        value = controller->command(params);
    }, Qt::BlockingQueuedConnection);
    return value;
}

void MpvAbstractItem::commandAsync(const QStringList &params, int id)
{
    auto *controller = d_ptr->m_mpvController;
    QMetaObject::invokeMethod(controller, [controller, params, id] {
        controller->commandAsync(params, id);
    }, Qt::QueuedConnection);
}

QVariant MpvAbstractItem::expandText(const QString &text)
{
    return commandBlocking({QStringLiteral("expand-text"), text});
}

void MpvAbstractItem::requestUpdateFromRenderer()
{
    update();
}

#include "moc_mpvabstractitem.cpp"
